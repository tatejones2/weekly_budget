import { app } from './app.ts';

const port = Number(process.env.PORT) || 3002;
app.listen(port, () => {
  console.log(`weekly_budget server listening on :${port}`);
});
