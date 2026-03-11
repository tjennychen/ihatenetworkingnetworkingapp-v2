import Nav from '@/components/Nav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="ml-56 min-h-screen p-8">
        {children}
      </main>
    </>
  )
}
