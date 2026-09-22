const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Campus Marketplace Backend is running.',
    environment: 'pre-production',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
