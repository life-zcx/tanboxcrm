"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverSources = discoverSources;
const web_fetch_1 = require("./web.fetch");
function discoverSources(parent, links) {
    if (parent.depth >= (parent.url.includes('eaeunion.org') ? 3 : 2))
        return [];
    const found = new Map();
    for (const link of links) {
        try {
            const url = (0, web_fetch_1.approvedUrl)(link.url);
            const attachment = /\.(pdf|docx)(?:[?#]|$)/i.test(url) || /\/api\/documents\/\d+\/(?:rus|kaz)\/.*(?:pdf|docx)/.test(url);
            const law = /\/rus\/docs\/[A-Z0-9]+\/?$/.test(new URL(url).pathname) && /маркиров|идентификац|прослежива|торговой деятельности/i.test(link.title);
            const operator = new URL(url).hostname === 'tanba.telecom.kz' && /\/business\/product\//.test(new URL(url).pathname);
            const technical = new URL(url).hostname === 'eec.eaeunion.org' && /\/deptexreg\/tr\/.+\.php/.test(new URL(url).pathname) && /(?:005\/2011|007\/2011|009\/2011|017\/2011|021\/2011|022\/2011|024\/2011|030\/2012|035\/2014|036\/2016|044\/2017|047\/2018)/.test(link.title);
            const act = new URL(url).hostname === 'docs.eaeunion.org' && /\/docs\/ru-ru\/|\/documents\/\d+\//.test(new URL(url).pathname) && /решение|изменен|переходн/i.test(link.title);
            if (!attachment && !law && !operator && !technical && !act)
                continue;
            let categoryCodes = parent.categoryCodes;
            if (technical) {
                if (/017\/2011/.test(link.title))
                    categoryCodes = ['shoes', 'textile'];
                else if (/009\/2011/.test(link.title))
                    categoryCodes = ['cosmetics'];
                else if (/044\/2017/.test(link.title))
                    categoryCodes = ['water'];
                else if (/024\/2011/.test(link.title))
                    categoryCodes = ['vegetable_oil'];
                else if (/030\/2012/.test(link.title))
                    categoryCodes = ['oils'];
                else if (/035\/2014/.test(link.title))
                    categoryCodes = ['tobacco'];
                else if (/036\/2016/.test(link.title))
                    categoryCodes = ['lpg'];
                else if (/047\/2018/.test(link.title))
                    categoryCodes = ['beer'];
                else if (/021\/2011|022\/2011/.test(link.title))
                    categoryCodes = ['water', 'bad', 'beer', 'vegetable_oil', 'confectionery', 'canned'];
                else
                    categoryCodes = ['GENERAL'];
            }
            found.set(url, { ...parent, url, title: link.title.replace(/^➥\s*/, '') || decodeURIComponent(new URL(url).pathname.split('/').pop() || url),
                categoryCodes, authority: law || act || technical || new URL(url).hostname === 'zan.gov.kz' ? 'LAW' : parent.authority,
                depth: parent.depth + 1, discoveredFrom: parent.url, priority: technical ? 20 : attachment ? 30 : 60, intervalHours: attachment ? 168 : 24 });
        }
        catch { }
    }
    return [...found.values()];
}
