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

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCode = qr;
      console.log('[Baileys] QR code gerado — escaneie com seu WhatsApp');
    }

    if (connection === 'open') {
      connected = true;
      qrCode = null;
      console.log('[Baileys] Conectado ao WhatsApp');
    }

    if (connection === 'close') {
      connected = false;
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
      console.log(`[FILTER] isSelf=${isSelfChat} isGroup=${isCommandGroup} cmdJid="${commandGroupJid}" remoteJid="${remoteJid}" jidMatch=${remoteJid === commandGroupJid} isOwner=${isOwnerSender} participant="${participant}" selfChatJid="${selfChatJid}"`);
      if (!isSelfChat && !isCommandGroup) continue;

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
