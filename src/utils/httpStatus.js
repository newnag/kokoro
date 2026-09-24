// Only an actual numeric HTTP response qualifies for an alert.
module.exports = result => Number.isInteger(result?.status_code)
  && result.status_code >= 100 && result.status_code <= 599;
