module.exports = async function handler(req, res) {
    const GOOGLE_URL = process.env.GOOGLE_SCRIPT_URL;

    if (!GOOGLE_URL) {
        return res.status(500).json({ error: "GOOGLE_SCRIPT_URL is not configured in Vercel." });
    }

    try {
        if (req.method === 'POST') {
            const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            const response = await fetch(GOOGLE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });
            const data = await response.json();
            return res.status(200).json(data);
        } else {
            const response = await fetch(GOOGLE_URL);
            const data = await response.json();
            return res.status(200).json(data);
        }
    } catch (error) {
        return res.status(500).json({ error: "Failed to connect to Google Sheets backend" });
    }
};
