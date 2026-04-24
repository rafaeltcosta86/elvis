import { describe, it, expect } from 'vitest';
import { substitutePronouns } from '../llmService';
import { parseCommand } from '../commandParser';

describe('Message Fidelity & Pronoun Substitution', () => {
  describe('substitutePronouns', () => {
    it('substitutes basic pronouns: eu -> você, meu -> seu, me -> te', () => {
      expect(substitutePronouns('eu vou chegar tarde')).toBe('você vou chegar tarde');
      expect(substitutePronouns('meu carro quebrou')).toBe('seu carro quebrou');
      expect(substitutePronouns('ele me ligou')).toBe('ele te ligou');
    });

    it('substitutes variations: minha -> sua, meus -> seus, minhas -> suas', () => {
      expect(substitutePronouns('minha chave sumiu')).toBe('sua chave sumiu');
      expect(substitutePronouns('meus documentos')).toBe('seus documentos');
      expect(substitutePronouns('minhas coisas')).toBe('suas coisas');
    });

    it('preserves case when substituting', () => {
      expect(substitutePronouns('Eu vou')).toBe('Você vou'); // Note: we don't fix conjugation here, just simple mapping as per AC
      expect(substitutePronouns('Meu carro')).toBe('Seu carro');
    });

    it('does not substitute inside other words', () => {
      expect(substitutePronouns('meu pneu furou')).toBe('seu pneu furou');
      expect(substitutePronouns('amém')).toBe('amém'); // 'me' inside 'amém'
      expect(substitutePronouns('comigo')).toBe('comigo'); // maybe 'comigo' -> 'com você' later? AC didn't specify
    });

    it('handles multiple substitutions', () => {
      expect(substitutePronouns('eu perdi meu celular e ele me ligou')).toBe('você perdi seu celular e ele te ligou');
    });
  });

  describe('Natural Language Command Parsing (commandParser)', () => {
    it('detects "pergunta" as SEND_TO', () => {
      const result = parseCommand('pergunta para o Guilherme se ele já instalou o Claude Code');
      expect(result.intent).toBe('SEND_TO');
      expect(result.args?.contactName).toBe('Guilherme');
      expect(result.args?.message).toBe('se ele já instalou o Claude Code');
    });

    it('detects "diz" as SEND_TO', () => {
      const result = parseCommand('diz para a Amanda que eu chego em 5 minutos');
      expect(result.intent).toBe('SEND_TO');
      expect(result.args?.contactName).toBe('Amanda');
      expect(result.args?.message).toBe('que eu chego em 5 minutos');
    });

    it('detects "fala pra" as SEND_TO', () => {
      const result = parseCommand('fala pra Estela que o RG dela tá aqui');
      expect(result.intent).toBe('SEND_TO');
      expect(result.args?.contactName).toBe('Estela');
      expect(result.args?.message).toBe('que o RG dela tá aqui');
    });
  });

  describe('End-to-End intention (Fidelity)', () => {
    it('AC1/AC3: preserves question tone and faithful content', () => {
      const rawCommand = 'manda uma mensagem para o Guilherme perguntando se ele já instalou o Claude Code';
      const parsed = parseCommand(rawCommand);

      expect(parsed.intent).toBe('SEND_TO');
      expect(parsed.args?.contactName).toBe('Guilherme');

      // Expected: "se ele já instalou o Claude Code" or similar faithful extraction
      // The exact extraction depends on commandParser regex
      expect(parsed.args?.message).toMatch(/se ele já instalou o Claude Code/i);
    });
  });

  describe('Pronoun Substitution (Tone preservation)', () => {
    it('preserves the "se" connector and substitutes pronoun', () => {
      const result = parseCommand('pergunta se eu posso ir');
      // "pergunta se eu posso ir" -> intent: CREATE_TASK -> LLM will classify as SEND_MESSAGE
      // The LLM will extract message: "se eu posso ir"
      // We check if substitutePronouns handles it
      expect(substitutePronouns('se eu posso ir')).toBe('se você posso ir');
    });

    it('preserves "que" and substitutes pronoun', () => {
      expect(substitutePronouns('que meu carro quebrou')).toBe('que seu carro quebrou');
    });
  });
});
