export default async function handler(req, res) {
  const { url } = req.query

  if (!url) {
    return res.status(400).json({ error: 'No url provided' })
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
        referer: 'http://megatek-sz.ru/',
        origin: 'http://megatek-sz.ru',
        cookie: req.headers.cookie || '',
      },
    })

    const text = await response.text()

    res.status(200).send(text)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
