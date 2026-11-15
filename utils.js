// Menerima hanya format YYYY-MM-DD, selain itu dianggap tidak ada filter
const dateParam = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
module.exports = { dateParam };
