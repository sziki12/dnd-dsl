import AppShell from "./shell/AppShell"

export default function PageWrapper({ children, name }: { children: React.ReactNode, name: string }) {

    return <AppShell pageName={name}>{children}</AppShell>
}