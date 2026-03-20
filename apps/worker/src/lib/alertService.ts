import { sendMessage } from './messenger';
import { isQuietHours } from './quietHours';
import { schedulerQueue } from './scheduler';

const OWNER_PHONE = () => process.env.OWNER_PHONE || '551199999999';
const QUEUE_STUCK_THRESHOLD = parseInt(process.env.QUEUE_STUCK_THRESHOLD || '20', 10);

export async function sendAlert(message: string): Promise<void> {
  if (isQuietHours()) {
    console.warn(`[ALERT suppressed - quiet hours] ${message}`);
    return;
  }
  console.warn(`[ALERT] ${message}`);
  await sendMessage(OWNER_PHONE(), `⚠️ Elvis Alert\n${message}`);
}

export async function onJobFailed(jobName: string | undefined, err: Error): Promise<void> {
  const name = jobName ?? 'unknown';
  await sendAlert(`Job "${name}" falhou: ${err.message}`);
}

export async function checkQueueHealth(): Promise<void> {
  const counts = await schedulerQueue.getJobCounts('waiting', 'active', 'failed');
  const stuck = (counts.waiting ?? 0) + (counts.active ?? 0);

  if (stuck > QUEUE_STUCK_THRESHOLD) {
    await sendAlert(
      `Fila travada: ${stuck} jobs pendentes/ativos (threshold: ${QUEUE_STUCK_THRESHOLD})`
    );
  }

  if ((counts.failed ?? 0) > 0) {
    await sendAlert(`${counts.failed} job(s) com status "failed" na fila`);
  }
}
