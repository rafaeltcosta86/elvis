import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import type { proto } from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import { readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// Message store for getMessage retries (Signal protocol re-encryption)
const msgStore = new Map<string, proto.IMessage>();
function storeMsg(id: string | null | undefined, msg: proto.IMessage | null | undefined) {
  if (!id || !msg) return;
  msgStore.set(id, msg);
  if (msgStore.size > 1000) {
    msgStore.delete(msgStore.keys().next().value!);
  }
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const OWNER_PHONE = process.env.OWNER_PHONE ?? '';
const ELVIS_API_URL = process.env.ELVIS_API_URL ?? 'http://api:3000';
const BAILEYS_WEBHOOK_SECRET = process.env.BAILEYS_WEBHOOK_SECRET ?? '';
const AUTH_DIR = process.env.AUTH_DIR ?? '/data/auth';

let sock: WASocket | null = null;
let connected = false;
let sessionReady = false; // true after WhatsApp finishes offline-notif sync
let qrCode: string | null = null;
let isFirstConnect = true;

// ─── Baileys connection ────────────────────────────────────────────────────

function clearStaleSessions(): void {
  if (!existsSync(AUTH_DIR)) return;
  const files = readdirSync(AUTH_DIR).filter(f => f.startsWith('session-'));
  for (const file of files) {
    unlinkSync(join(AUTH_DIR, file));
  }
  if (files.length > 0) {
    console.log(`[Baileys] ${files.length} sessão(ões) removida(s) — serão re-estabelecidas`);
  }
}

async function connect(): Promise<void> {
  if (isFirstConnect) {
    clearStaleSessions();
    isFirstConnect = false;
  }
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  // Patch: sessions marked closed === -1 cause assertSessions to throw "Session closed"
  // during message retries. Returning undefined instead forces Baileys to create a fresh
  // session rather than failing permanently, which resolves "Waiting for this message".
  const baseKeyStore = makeCacheableSignalKeyStore(state.keys, console as any);
  const originalGet = baseKeyStore.get.bind(baseKeyStore);
  (baseKeyStore as any).get = async (type: string, ids: string[]) => {
    const result = await originalGet(type as any, ids);
    if (type === 'session') {
      for (const id of ids) {
        if ((result as any)[id]?.closed === -1) {
          console.log(`[Baileys] Sessão fechada para ${id} — criando nova sessão`);
          delete (result as any)[id];
        }
      }
    }
    return result;
  };

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: baseKeyStore,
    },
    printQRInTerminal: true,
    browser: ['Elvis', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    getMessage: async (key) => key.id ? msgStore.get(key.id) : undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr, receivedPendingNotifications }) => {
    if (qr) {
      qrCode = qr;
      console.log('[Baileys] QR code gerado — escaneie com seu WhatsApp');
    }

    if (connection === 'open') {
      connected = true;
      qrCode = null;
      if (sessionReady) {
        console.log('[Baileys] Conectado ao WhatsApp — sessão já sincronizada');
      } else {
        console.log('[Baileys] Conectado ao WhatsApp — aguardando sync...');
      }
    }

    if (receivedPendingNotifications) {
      sessionReady = true;
      console.log('[Baileys] Sessão sincronizada — pronto para enviar');
    }

    if (connection === 'close') {
      connected = false;
      sessionReady = false;
      const status = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = status !== DisconnectReason.loggedOut;
      console.log(`[Baileys] Conexão encerrada (status=${status}). Reconectar: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => { connect().catch(console.error); }, 3000);
      } else {
        console.log('[Baileys] Deslogado — delete /data/auth e reinicie para reconectar');
      }
    }
  });

  // ── ACK tracking (SERVER_ACK=1, DELIVERY_ACK=2, READ=3) ───────────────
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (key.fromMe && update.status !== undefined) {
        console.log(`[ACK] jid=${key.remoteJid} id=${key.id?.slice(0, 8)} status=${update.status}`);
      }
    }
  });

  // ── Incoming messages ──────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Store all messages for getMessage retries (Signal protocol)
    for (const msg of messages) {
      storeMsg(msg.key.id, msg.message);
    }

    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid ?? '';
      const fromMe = msg.key.fromMe ?? false;
      const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
      const participant = msg.key.participant ?? '';
      console.log(`[DEBUG] type=${type} fromMe=${fromMe} jid=${remoteJid} participant=${participant} ownerJid=${ownerJid} hasMsg=${!!msg.message}`);
    }

    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid ?? '';
      const fromMe = msg.key.fromMe ?? false;
      const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;

      // Accept: self-chat (fromMe=true) OR command group (owner is sender)
      const selfChatJid = process.env.SELF_CHAT_JID ?? ownerJid;
      const commandGroupJid = process.env.COMMAND_GROUP_JID ?? '';
      const participant = msg.key.participant ?? '';
      const isOwnerSender = fromMe || participant.startsWith(OWNER_PHONE) || participant === selfChatJid;
      const isSelfChat = fromMe && remoteJid === selfChatJid;
      const isCommandGroup = !!commandGroupJid && remoteJid === commandGroupJid && isOwnerSender;
      // WhatsApp uses @lid (privacy-preserving local ID) for incoming DMs — cannot compare
      // to OWNER_PHONE@s.whatsapp.net. Since the Elvis chip is private and dedicated,
      // any non-group non-broadcast incoming DM is treated as an owner command.
      const isOwnerDm = !fromMe && !remoteJid.endsWith('@g.us') && !remoteJid.endsWith('@broadcast');
      console.log(`[FILTER] isSelf=${isSelfChat} isGroup=${isCommandGroup} isOwnerDm=${isOwnerDm} cmdJid="${commandGroupJid}" remoteJid="${remoteJid}" jidMatch=${remoteJid === commandGroupJid} isOwner=${isOwnerSender} participant="${participant}" selfChatJid="${selfChatJid}"`);
      if (!isSelfChat && !isCommandGroup && !isOwnerDm) continue;

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        '';
      if (!text.trim()) continue;

      console.log(`[Baileys] self-chat → "${text}"`);

      try {
        // For groups, reply to the group JID. For self-chat @lid, reply to OWNER_PHONE.
        const replyTo = remoteJid.endsWith('@g.us') ? remoteJid : OWNER_PHONE;
        await axios.post(
          `${ELVIS_API_URL}/webhook/baileys`,
          {
            sender_id: replyTo,
            message_text: text,
            message_id: msg.key.id ?? '',
            timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
          },
          {
            headers: { Authorization: `Bearer ${BAILEYS_WEBHOOK_SECRET}` },
            timeout: 10_000,
          }
        );
      } catch (err) {
        console.error('[Baileys] Erro ao encaminhar para Elvis:', err instanceof Error ? err.message : err);
      }
    }
  });
}

// ─── Express API ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/status', (_req, res) => {
  res.json({ connected, qr: qrCode ?? undefined });
});

app.post('/send', async (req, res) => {
  const { to, text } = req.body as { to?: string; text?: string };
  if (!to || !text) {
    res.status(400).json({ error: 'to and text are required' });
    return;
  }
  if (!sock || !connected) {
    res.status(503).json({ error: 'WhatsApp not connected' });
    return;
  }
  if (!sessionReady) {
    // Wait up to 30s for session sync before giving up
    const deadline = Date.now() + 30_000;
    while (!sessionReady && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!sessionReady) {
      console.warn('[Baileys] /send: sessão não sincronizada após 30s — enviando mesmo assim');
    }
  }
  try {
    // Groups (@g.us) and phone numbers work fine.
    // @lid cannot be used for sending — fallback to OWNER_PHONE.
    let jid: string;
    if (to.endsWith('@lid')) {
      jid = `${OWNER_PHONE}@s.whatsapp.net`;
    } else {
      jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    }
    console.log(`[Baileys] /send → jid="${jid}" text="${text.substring(0, 50)}"`);
    const result = await sock.sendMessage(jid, { text });
    if (result) storeMsg(result.key.id, result.message);
    console.log(`[Baileys] /send ✓ enviado para ${jid}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Baileys] Erro ao enviar:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'send failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[Baileys] Serviço rodando na porta ${PORT}`);
});

// ─── Start ─────────────────────────────────────────────────────────────────

connect().catch(console.error);
