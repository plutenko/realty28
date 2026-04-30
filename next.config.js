/** @type {import('next').NextConfig} */
const nextConfig = {
  // На Timeweb контейнер запускается под user 'app', а /app/.next/cache/images
  // не существует и не может быть создана (EACCES). Это роняло процесс при
  // первом запросе Next/Image, контейнер ребутался, а Telegram callback'и
  // (например «🔥 Беру») терялись. Картинки и так оптимизированы заранее
  // (WebP с админ-кропа), runtime-оптимизация не нужна.
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: '/buildings',
        destination: '/apartments?view=complexes',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
