import { BackendContextNode } from "./BackendContext";
import { DslContextNode } from "./DslContext";
import { EditorContextNode } from "./EditorContext";
import { MonacoContextNode } from "./MonacoContext";

export function ContextWrapper({ children }: { children: React.ReactNode }) {

    return (
        <BackendContextNode>
            <DslContextNode>
                <EditorContextNode>
                    <MonacoContextNode>
                        {children}
                    </MonacoContextNode>
                </EditorContextNode>
            </DslContextNode>
        </BackendContextNode>
    );
}