export interface FileDto {
    identifier: FileIdentifier;
    content: string;
}

export interface FileIdentifier {
    world: string;
    adventure: string;
}