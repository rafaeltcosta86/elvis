import { parseCommand } from '../commandParser';

describe('parseCommand', () => {
  describe('/comandos', () => {
    it('returns LIST_COMMANDS intent for /comandos', () => {
      expect(parseCommand('/comandos')).toEqual({ intent: 'LIST_COMMANDS' });
    });

    it('returns LIST_COMMANDS intent for /COMANDOS (case-insensitive)', () => {
      expect(parseCommand('/COMANDOS')).toEqual({ intent: 'LIST_COMMANDS' });
    });
  });

  describe('/<cmd> desc', () => {
    it('returns DESCRIBE_COMMAND intent for /contatos desc', () => {
      expect(parseCommand('/contatos desc')).toEqual({
        intent: 'DESCRIBE_COMMAND',
        args: { commandName: '/contatos' },
      });
    });

    it('returns DESCRIBE_COMMAND intent for /hoje DESC (case-insensitive)', () => {
      expect(parseCommand('/hoje DESC')).toEqual({
        intent: 'DESCRIBE_COMMAND',
        args: { commandName: '/hoje' },
      });
    });

    it('detects /<cmd> desc before ALIAS_SHORTCUT', () => {
      // If we didn't have special handling, /contatos desc would be an ALIAS_SHORTCUT
      expect(parseCommand('/contatos desc')).toEqual({
        intent: 'DESCRIBE_COMMAND',
        args: { commandName: '/contatos' },
      });
    });

    it('falls through to ALIAS_SHORTCUT if command is not in registry (per PR feedback)', () => {
      expect(parseCommand('/unknown desc')).toEqual({
        intent: 'ALIAS_SHORTCUT',
        args: { alias: '/unknown', message: 'desc' },
      });
    });
  });

  describe('/contatos', () => {
    it('returns LIST_CONTACTS intent for /contatos', () => {
      expect(parseCommand('/contatos')).toEqual({ intent: 'LIST_CONTACTS' });
    });

    it('returns LIST_CONTACTS intent for /CONTATOS (case-insensitive)', () => {
      expect(parseCommand('/CONTATOS')).toEqual({ intent: 'LIST_CONTACTS' });
    });
  });

  describe('/hoje', () => {
    it('returns TODAY intent for /hoje', () => {
      expect(parseCommand('/hoje')).toEqual({ intent: 'TODAY' });
    });

    it('returns TODAY intent for /HOJE (case-insensitive)', () => {
      expect(parseCommand('/HOJE')).toEqual({ intent: 'TODAY' });
    });
  });

  describe('/done', () => {
    it('returns DONE intent with taskId for /done abc-123', () => {
      expect(parseCommand('/done abc-123')).toEqual({
        intent: 'DONE',
        args: { taskId: 'abc-123' },
      });
    });
  });

  describe('/adiar', () => {
    it('returns POSTPONE intent with taskId and to for /adiar abc-123 amanha', () => {
      expect(parseCommand('/adiar abc-123 amanha')).toEqual({
        intent: 'POSTPONE',
        args: { taskId: 'abc-123', to: 'amanha' },
      });
    });
  });

  describe('/semana', () => {
    it('returns WEEK intent for /semana', () => {
      expect(parseCommand('/semana')).toEqual({ intent: 'WEEK' });
    });
  });

  describe('/email', () => {
    it('returns EMAIL intent for /email', () => {
      expect(parseCommand('/email')).toEqual({ intent: 'EMAIL' });
    });
  });

  describe('ALIAS_SHORTCUT', () => {
    it('returns ALIAS_SHORTCUT for /linic <msg>', () => {
      expect(parseCommand('/linic olá tudo bem')).toEqual({
        intent: 'ALIAS_SHORTCUT',
        args: { alias: '/linic', message: 'olá tudo bem' },
      });
    });

    it('returns ALIAS_SHORTCUT for /li <msg>', () => {
      expect(parseCommand('/li oi')).toEqual({
        intent: 'ALIAS_SHORTCUT',
        args: { alias: '/li', message: 'oi' },
      });
    });

    it('does NOT return ALIAS_SHORTCUT for known commands like /hoje', () => {
      expect(parseCommand('/hoje')).toEqual({ intent: 'TODAY' });
    });
  });

  describe('/confirmar', () => {
    it('returns CONFIRM intent with communication_id', () => {
      expect(parseCommand('/confirmar abc-123')).toEqual({
        intent: 'CONFIRM',
        args: { communication_id: 'abc-123' },
      });
    });

    it('handles UUID communication_id', () => {
      expect(parseCommand('/confirmar 550e8400-e29b-41d4-a716-446655440000')).toEqual({
        intent: 'CONFIRM',
        args: { communication_id: '550e8400-e29b-41d4-a716-446655440000' },
      });
    });
  });

  describe('/cancelar', () => {
    it('returns CANCEL intent with communication_id', () => {
      expect(parseCommand('/cancelar abc-123')).toEqual({
        intent: 'CANCEL',
        args: { communication_id: 'abc-123' },
      });
    });
  });

  describe('UNKNOWN (natural language fallback)', () => {
    it('returns UNKNOWN intent with rawText for plain text', () => {
      expect(parseCommand('comprar leite')).toEqual({
        intent: 'UNKNOWN',
        args: { rawText: 'comprar leite' },
      });
    });

    it('trims whitespace from rawText', () => {
      expect(parseCommand('  comprar leite  ')).toEqual({
        intent: 'UNKNOWN',
        args: { rawText: 'comprar leite' },
      });
    });

    it('returns UNKNOWN with empty rawText for empty string', () => {
      expect(parseCommand('')).toEqual({
        intent: 'UNKNOWN',
        args: { rawText: '' },
      });
    });

    it('returns UNKNOWN for previous SEND_TO patterns', () => {
      expect(parseCommand('manda para amanda: oi').intent).toBe('UNKNOWN');
      expect(parseCommand('Manda um oi pra Amanda.').intent).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for previous CREATE_EVENT patterns', () => {
      expect(parseCommand('marca reunião').intent).toBe('UNKNOWN');
    });
  });
});
