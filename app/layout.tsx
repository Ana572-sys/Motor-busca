import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Radar G&I | Crowe', description: 'Monitorização de oportunidades de financiamento' };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="pt"><body>{children}</body></html>; }
