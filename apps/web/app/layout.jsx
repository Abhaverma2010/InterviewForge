import { AppHeader } from '@/components/AppHeader';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata = {
  title: 'InterviewForge',
  description: 'Turn a job description into a personalised interview prep kit.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <AuthProvider>
          <ToastProvider>
            <AppHeader />
            <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6">
              {children}
            </main>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
