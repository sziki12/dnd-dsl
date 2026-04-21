import { MonacoContextNode } from "./MonacoContext";

export function ContextWrapper({ children }: { children: React.ReactNode }) {

    return (
        <MonacoContextNode>
            {children}
        </MonacoContextNode>
    );
}