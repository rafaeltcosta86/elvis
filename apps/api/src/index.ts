import express from 'express';
import healthRouter from './routes/health';
import statusRouter from './routes/status';
import tasksRouter from './routes/tasks';
import todayRouter from './routes/today';
import jobsRouter from './routes/jobs';
import webhookRouter from './routes/webhook';
import calendarRouter from './routes/calendar';
import emailRouter from './routes/email';
import userRouter from './routes/user';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/', healthRouter);
app.use('/', statusRouter);
app.use('/', tasksRouter);
app.use('/', todayRouter);
app.use('/', jobsRouter);
app.use('/', webhookRouter);
app.use('/', calendarRouter);
app.use('/', emailRouter);
app.use('/', userRouter);

app.listen(PORT, () => {
  console.log(`api ready on port ${PORT}`);
});
