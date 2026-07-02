const { json } = require('./_response');

exports.handler = async () => json(410, {
  error: 'Checkout has been retired. DevDad Strength is now free with registration.',
});
