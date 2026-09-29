import AppShell from "./shell/AppShell"

export default function PageWrapper({ children }: { children: React.ReactNode }) {

    return <AppShell>{children}</AppShell>
}