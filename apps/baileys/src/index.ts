import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const OWNER_PHONE = process.env.OWNER_PHONE ?? '';
const ELVIS_API_URL = process.env.ELVIS_API_URL ?? 'http://api:3000';
const BAILEYS_WEBHOOK_SECRET = process.env.BAILEYS_WEBHOOK_SECRET ?? '';
const AUTH_DIR = process.env.AUTH_DIR ?? '/data/auth';

let sock: WASocket | null = null;
let connected = false;
let qrCode: string | null = null;

// ─── Baileys connection ────────────────────────────────────────────────────

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console as any),
    },
    printQRInTerminal: true,
    browser: ['Elvis', 'Chrome', '1.0.0'],
    syncFullHistory: false,
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
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid ?? '';
      const fromMe = msg.key.fromMe ?? false;
      const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
      console.log(`[DEBUG] type=${type} fromMe=${fromMe} jid=${remoteJid} ownerJid=${ownerJid} hasMsg=${!!msg.message}`);
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
      const isOwnerSender = fromMe || participant.startsWith(OWNER_PHONE);
      const isSelfChat = fromMe && remoteJid === selfChatJid;
      const isCommandGroup = !!commandGroupJid && remoteJid === commandGroupJid && isOwnerSender;
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
    await sock.sendMessage(jid, { text });
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
