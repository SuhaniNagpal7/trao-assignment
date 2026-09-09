import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Ahead — Interview preparation', description: 'A focused workspace for your next interview.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
