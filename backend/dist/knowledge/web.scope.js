"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupportingTechnicalSource = isSupportingTechnicalSource;
exports.asksForTechnicalStandards = asksForTechnicalStandards;
exports.sharedOperatorDocumentIds = sharedOperatorDocumentIds;
function isSupportingTechnicalSource(source) {
    return source.url.startsWith('https://docs.eaeunion.org/upload/') &&
        !!source.discoveredFrom?.startsWith('https://docs.eaeunion.org/');
}
function asksForTechnicalStandards(query) {
    return /техническ|техрегламент|стандарт|ГОСТ|ТР\s*ТС|безопасност/i.test(query);
}
function sharedOperatorDocumentIds(sources, revisions) {
    const hashes = new Map(revisions.map(revision => [revision.id, revision.sha256]));
    const groups = new Map();
    for (const source of sources) {
        if (source.authority !== 'OPERATOR' || !source.currentRevisionId)
            continue;
        const hash = hashes.get(source.currentRevisionId);
        if (!hash)
            continue;
        const group = groups.get(hash) || { ids: [], categories: new Set() };
        group.ids.push(source.id);
        for (const code of source.categoryCodes)
            if (code !== 'GENERAL')
                group.categories.add(code);
        groups.set(hash, group);
    }
    return new Set([...groups.values()].filter(group => group.ids.length > 1 && group.categories.size > 1).flatMap(group => group.ids));
}
