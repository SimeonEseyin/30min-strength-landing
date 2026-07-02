const { json } = require('./_response');

exports.handler = async () => json(410, {
  verified: false,
  error: 'Purchase verification has been retired. DevDad Strength is now free with registration.',
});
