import { BadRequestException } from '@nestjs/common';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSafeSegment, readMapView, writeMapView } from './map-view-store';

describe('map view store', () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapview-'));
        file = path.join(dir, 'World.mapview.json');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const SETTINGS = { version: 1, labels: false, colors: { all: '#112233' } };

    it('has nothing for a world that was never saved', () => {
        expect(readMapView(file, 'Town')).toEqual({});
        expect(fs.existsSync(file)).toBe(false);
    });

    it('a load without a location is empty, not an error', () => {
        writeMapView(file, 'Town', SETTINGS);
        expect(readMapView(file, undefined as unknown as string)).toEqual({});
    });

    it('returns what was saved for a location', () => {
        writeMapView(file, 'Town', SETTINGS);
        expect(readMapView(file, 'Town')).toEqual(SETTINGS);
    });

    it('keeps locations apart', () => {
        writeMapView(file, 'Town', SETTINGS);
        writeMapView(file, 'Castle', { version: 1, labels: true });
        expect(readMapView(file, 'Town')).toEqual(SETTINGS);
        expect(readMapView(file, 'Castle')).toEqual({ version: 1, labels: true });
        expect(readMapView(file, 'Elsewhere')).toEqual({});
    });

    it('replaces a location without touching the others', () => {
        writeMapView(file, 'Town', SETTINGS);
        writeMapView(file, 'Castle', { version: 1 });
        writeMapView(file, 'Town', { version: 1, labels: true });
        expect(readMapView(file, 'Town')).toEqual({ version: 1, labels: true });
        expect(readMapView(file, 'Castle')).toEqual({ version: 1 });
    });

    it('treats an empty object as "back to the defaults" and removes the entry', () => {
        writeMapView(file, 'Town', SETTINGS);
        writeMapView(file, 'Castle', { version: 1 });
        writeMapView(file, 'Town', {});
        expect(readMapView(file, 'Town')).toEqual({});
        expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ Castle: { version: 1 } });
    });

    it('clearing a location that was never saved is harmless', () => {
        expect(() => writeMapView(file, 'Town', {})).not.toThrow();
        expect(readMapView(file, 'Town')).toEqual({});
    });

    it('handles locations named like object internals without touching prototypes', () => {
        writeMapView(file, '__proto__', { version: 1, labels: false });
        writeMapView(file, 'constructor', { version: 1, labels: true });
        expect(readMapView(file, '__proto__')).toEqual({ version: 1, labels: false });
        expect(readMapView(file, 'constructor')).toEqual({ version: 1, labels: true });
        expect(({} as Record<string, unknown>).labels).toBeUndefined();
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it('does not mistake an inherited key for a saved location', () => {
        writeMapView(file, 'Town', SETTINGS);
        expect(readMapView(file, 'toString')).toEqual({});
        expect(readMapView(file, 'hasOwnProperty')).toEqual({});
    });

    it('a location called __proto__ with nothing saved is a fresh empty object, not Object.prototype', () => {
        writeMapView(file, 'Town', SETTINGS);
        const entry = readMapView(file, '__proto__');
        expect(entry).toEqual({});
        expect(entry).not.toBe(Object.prototype);
    });

    it('removes its temporary file when the write cannot be completed', () => {
        fs.mkdirSync(file); // a folder where the settings file should be, so the final rename fails
        expect(() => writeMapView(file, 'Town', SETTINGS)).toThrow();
        expect(fs.readdirSync(dir)).toEqual(['World.mapview.json']);
    });

    it('reads a broken file as empty and the next save replaces it', () => {
        fs.writeFileSync(file, '{ "Town": { "versi', 'utf-8');
        expect(readMapView(file, 'Town')).toEqual({});
        writeMapView(file, 'Town', SETTINGS);
        expect(readMapView(file, 'Town')).toEqual(SETTINGS);
    });

    it('reads a file that is not an object, or an entry that is not an object, as empty', () => {
        fs.writeFileSync(file, '[1, 2]', 'utf-8');
        expect(readMapView(file, 'Town')).toEqual({});
        fs.writeFileSync(file, JSON.stringify({ Town: 'nope', Castle: [1] }), 'utf-8');
        expect(readMapView(file, 'Town')).toEqual({});
        expect(readMapView(file, 'Castle')).toEqual({});
    });

    it('refuses what is not a small plain object, and a missing location', () => {
        expect(() => writeMapView(file, 'Town', [1])).toThrow(BadRequestException);
        expect(() => writeMapView(file, 'Town', 'x')).toThrow(BadRequestException);
        expect(() => writeMapView(file, 'Town', null)).toThrow(BadRequestException);
        expect(() => writeMapView(file, 'Town', { big: 'x'.repeat(30_000) })).toThrow(BadRequestException);
        expect(() => writeMapView(file, '', SETTINGS)).toThrow(BadRequestException);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('leaves no temporary file behind', () => {
        writeMapView(file, 'Town', SETTINGS);
        writeMapView(file, 'Town', {});
        expect(fs.readdirSync(dir)).toEqual(['World.mapview.json']);
    });

    it('writes valid, readable JSON', () => {
        writeMapView(file, 'Town', SETTINGS);
        expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ Town: SETTINGS });
    });
});

describe('isSafeSegment', () => {
    it('accepts ordinary names, including spaces and dots inside', () => {
        for (const ok of ['Adventure', 'My World', 'v1.2', 'a..b']) expect(isSafeSegment(ok)).toBe(true);
    });

    it('rejects anything that could leave the folder, and non-strings', () => {
        for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'x\0y', undefined, null, 3]) expect(isSafeSegment(bad)).toBe(false);
    });
});
