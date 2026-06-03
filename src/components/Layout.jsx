import { Outlet } from 'react-router-dom'
import Header from './Header.jsx'

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Outlet />
      </main>
    </div>
  )
}
