import { BackendContextNode } from "./BackendContext";
import { DslContextNode } from "./DslContext";
import { FileContextNode } from "./FileContext";
import { MonacoContextNode } from "./MonacoContext";
import { ScriptStateContextNode } from "./ScriptStateContext";

export function ContextWrapper({ children }: { children: React.ReactNode }) {

    return (
        <BackendContextNode>
            <DslContextNode>
                <FileContextNode>
                    <MonacoContextNode>
                        <ScriptStateContextNode>
                            {children}
                        </ScriptStateContextNode>
                    </MonacoContextNode>
                </FileContextNode>
            </DslContextNode>
        </BackendContextNode>
    );
}