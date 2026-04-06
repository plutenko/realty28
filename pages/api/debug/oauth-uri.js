export default function handler(req, res) {
  res.status(200).json({
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || '(не задана)',
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID ? '✓ задан' : '(не задан)',
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET ? '✓ задан' : '(не задан)',
  })
}
