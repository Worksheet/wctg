const { randomBytes } = require('crypto');

function generateToken() {
  return randomBytes(24).toString('hex');
}

module.exports = { generateToken };
