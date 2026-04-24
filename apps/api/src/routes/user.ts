import { Router } from 'express';
import { getOrCreateProfile, updateInferredPrefs } from '../lib/userModel';
import prisma from '../lib/prisma';
import { sanitizeError } from '../lib/logger';

const router = Router();

const VALID_ACTIONS = ['more_proactive', 'less_proactive', 'reset_prefs'] as const;
type FeedbackAction = (typeof VALID_ACTIONS)[number];

router.get('/user/profile', async (_req, res) => {
  try {
    await updateInferredPrefs();
    const profile = await getOrCreateProfile();
    res.json(profile);
  } catch (err) {
    console.error('GET /user/profile error:', sanitizeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/user/profile/feedback', async (req, res) => {
  try {
    const { action } = req.body as { action?: string };

    if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
      return res.status(400).json({ error: `Invalid action. Valid: ${VALID_ACTIONS.join(', ')}` });
    }

    const profile = await getOrCreateProfile();

    let updateData: Record<string, unknown> = {};

    if (action === 'more_proactive') {
      const newLevel = Math.min(5, profile.proactivity_level + 1);
      updateData = { proactivity_level: newLevel };
    } else if (action === 'less_proactive') {
      const newLevel = Math.max(1, profile.proactivity_level - 1);
      updateData = { proactivity_level: newLevel };
    } else if (action === 'reset_prefs') {
      updateData = { inferred_prefs: {}, confidence: {} };
    }

    const updated = await prisma.userProfile.update({
      where: { id: profile.id },
      data: updateData,
    });

    const messages: Record<FeedbackAction, string> = {
      more_proactive: `✅ Entendi! Vou ser mais proativo. Nível atual: ${updated.proactivity_level}/5`,
      less_proactive: `✅ Entendi! Vou ser menos insistente. Nível atual: ${updated.proactivity_level}/5`,
      reset_prefs: '🔄 Preferências resetadas. Vou aprender seus hábitos do zero.',
    };

    res.json({
      proactivity_level: updated.proactivity_level,
      message: messages[action as FeedbackAction],
    });
  } catch (err) {
    console.error('POST /user/profile/feedback error:', sanitizeError(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
