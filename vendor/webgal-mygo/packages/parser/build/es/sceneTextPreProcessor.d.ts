/**
 * Preprocessor for scene text.
 *
 * Use two-pass to generate a new scene text that concats multiline sequences
 * into a single line and add placeholder lines to preserve the original number
 * of lines.
 *
 * @param sceneText The original scene text
 * @returns The processed scene text
 */
export declare function sceneTextPreProcess(sceneText: string): string;
