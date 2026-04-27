/** @type {import('next').NextConfig} */
const nextConfig = {
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
