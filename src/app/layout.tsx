import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import Footer from '@/components/Footer'
import { Providers } from '@/components/Providers'

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
})

export const metadata: Metadata = {
	title: 'Clock Out | Simple Time Tracking',
	description: 'Clean and efficient time tracking for your organization.',
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html className="h-full" lang="en">
			<body
				className={`${geistSans.variable} ${geistMono.variable} flex min-h-full flex-col bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50`}
			>
				<Providers>
					<div className="flex min-h-screen flex-col">
						<main className="flex-1">
							{children}
							<Analytics />
						</main>
						<Footer />
					</div>
				</Providers>
			</body>
		</html>
	)
}
