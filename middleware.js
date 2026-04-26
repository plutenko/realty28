import { NextResponse } from 'next/server'

function toPunycode(host) {
  if (!host) return ''
  try {
    return new URL(`http://${host.split(':')[0]}`).hostname.toLowerCase()
  } catch {
    return host.toLowerCase()
  }
}

const PUBLIC_HOST = toPunycode(process.env.PUBLIC_COLLECTION_HOST || '')

function isAllowedOnPublicHost(pathname) {
  if (pathname.startsWith('/collections/')) return true
  if (pathname === '/api/collections/public') return true
  if (pathname === '/api/collections/view') return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico') return true
  if (pathname === '/logo.png') return true
  if (pathname === '/robots.txt') return true
  return false
}

export function middleware(req) {
  if (!PUBLIC_HOST) return NextResponse.next()

  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0]
  if (host !== PUBLIC_HOST) return NextResponse.next()

  if (isAllowedOnPublicHost(req.nextUrl.pathname)) return NextResponse.next()

  return NextResponse.rewrite(new URL('/404', req.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
