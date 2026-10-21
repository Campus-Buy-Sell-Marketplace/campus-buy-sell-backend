import http from 'http';
import app from './app';
import { initSocketIO } from './socket';
import { startOrderCleanupJob } from './services/cleanup.service';

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.IO real-time engine
initSocketIO(server);

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health\n`);

  // Gentle background sweeper to expire stale unpaid online orders every 5 minutes (300,000ms)
  startOrderCleanupJob(300000);
});


