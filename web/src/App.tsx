import { MotionConfig } from 'motion/react'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { FullPageLoader } from '@/components/layout/FullPageLoader'
import { RouteError } from '@/components/layout/RouteError'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { RequireRole } from '@/features/auth/guards'
import { ChooseRolePage, RoleAuthPage } from '@/pages/auth/AuthPages'
import { LandingPage } from '@/pages/landing/LandingPage'
import { InviteLanding, NotFoundPage, PrivacyPage } from '@/pages/shared/PublicPages'
import { ThemeProvider } from '@/lib/theme'

// Role areas are code-split so the landing page stays light.
const lazyNamed = <T, K extends keyof T>(loader: () => Promise<T>, name: K) =>
  lazy(async () => ({ default: (await loader())[name] as unknown as React.ComponentType }))
const trainer = () => import('@/pages/trainer/TrainerPages')
const client = () => import('@/pages/client/ClientPages')
const shared = () => import('@/pages/shared/SharedPages')
const healthImport = () => import('@/pages/import/HealthImportPage')

const TrainerDashboard = lazyNamed(trainer, 'TrainerDashboard')
const TrainerClientsPage = lazyNamed(trainer, 'TrainerClientsPage')
const TrainerClientDetail = lazyNamed(trainer, 'TrainerClientDetail')
const TrainerSessionsPage = lazyNamed(trainer, 'TrainerSessionsPage')
const TrainerInvitationsPage = lazyNamed(trainer, 'TrainerInvitationsPage')
const ClientDashboard = lazyNamed(client, 'ClientDashboard')
const ClientCheckInPage = lazyNamed(client, 'ClientCheckInPage')
const ClientHistoryPage = lazyNamed(client, 'ClientHistoryPage')
const ClientHealthPage = lazyNamed(client, 'ClientHealthPage')
const SettingsPage = lazyNamed(shared, 'SettingsPage')
const JoinTrainerPage = lazyNamed(shared, 'JoinTrainerPage')
const HealthImportPage = lazyNamed(healthImport, 'HealthImportPage')

const s = (el: React.ReactNode) => <Suspense fallback={<FullPageLoader />}>{el}</Suspense>

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/auth', element: <ChooseRolePage /> },
      { path: '/auth/:role', element: <RoleAuthPage /> },
      { path: '/invite/:code', element: <InviteLanding /> },
      // Phone-side Apple Health import: no login session (QR code → upload-only token).
      { path: '/import', element: s(<HealthImportPage />) },
      { path: '/import/:code', element: s(<HealthImportPage />) },
      {
        element: <RequireRole role="trainer" />,
        children: [
          {
            path: '/trainer',
            element: <AppShell />,
            children: [
              { index: true, element: s(<TrainerDashboard />) },
              { path: 'clients', element: s(<TrainerClientsPage />) },
              { path: 'clients/:clientId', element: s(<TrainerClientDetail />) },
              { path: 'sessions', element: s(<TrainerSessionsPage />) },
              { path: 'invitations', element: s(<TrainerInvitationsPage />) },
              { path: 'settings', element: s(<SettingsPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole role="client" />,
        children: [
          {
            path: '/client',
            element: <AppShell />,
            children: [
              { index: true, element: s(<ClientDashboard />) },
              { path: 'check-in', element: s(<ClientCheckInPage />) },
              { path: 'history', element: s(<ClientHistoryPage />) },
              { path: 'health', element: s(<ClientHealthPage />) },
              { path: 'join', element: s(<JoinTrainerPage />) },
              { path: 'settings', element: s(<SettingsPage />) },
            ],
          },
        ],
      },
      { path: '/login', element: <Navigate to="/auth" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export default function App() {
  return (
    // reducedMotion="user": every Motion animation (hover, page transitions, parallax)
    // follows the OS "reduce motion" setting.
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}
