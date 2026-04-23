import { EditorContextNode } from "./EditorContext";
import { MonacoContextNode } from "./MonacoContext";

export function ContextWrapper({ children }: { children: React.ReactNode }) {

    return (
        <EditorContextNode>
            <MonacoContextNode>
                {children}
            </MonacoContextNode>
        </EditorContextNode>
        
    );
}