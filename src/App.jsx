import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import NewCase from './pages/NewCase.jsx'
import CasesList from './pages/CasesList.jsx'
import CaseDetail from './pages/CaseDetail.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cases/new" element={<NewCase />} />
          <Route path="/cases" element={<CasesList />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
