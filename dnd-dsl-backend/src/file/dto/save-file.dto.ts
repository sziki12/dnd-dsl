export interface FileDto {
    identifier: FileIdentifier;
    content: string;
    /** The file within the world; left out for a world of one file. */
    file?: string;
}

export interface FileIdentifier {
    world: string;
    adventure: string;
}
