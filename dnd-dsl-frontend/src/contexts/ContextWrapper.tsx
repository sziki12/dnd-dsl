import { BackendContextNode } from "./BackendContext";
import { DslContextNode } from "./DslContext";
import { FileContextNode } from "./FileContext";
import { MonacoContextNode } from "./MonacoContext";

export function ContextWrapper({ children }: { children: React.ReactNode }) {

    return (
        <BackendContextNode>
            <DslContextNode>
                <FileContextNode>
                    <MonacoContextNode>
                        {children}
                    </MonacoContextNode>
                </FileContextNode>
            </DslContextNode>
        </BackendContextNode>
    );
}