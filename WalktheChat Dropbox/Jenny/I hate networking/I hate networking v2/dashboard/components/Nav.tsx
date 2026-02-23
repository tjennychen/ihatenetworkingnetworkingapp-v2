'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

const links = [
  { href: '/contacts', label: 'Contacts' },
  { href: '/stats',    label: 'Stats' },
  { href: '/post',     label: 'Post Generator' },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <nav className="fixed left-0 top-0 h-full w-56 bg-white border-r border-gray-100 flex flex-col p-4">
      <div className="mb-8">
        <span className="text-sm font-bold text-gray-900">I Hate Networking</span>
      </div>
      <div className="flex-1 space-y-1">
        {links.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              'block px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              pathname === link.href
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <button
        onClick={handleLogout}
        className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 text-left"
      >
        Sign out
      </button>
    </nav>
  )
}
