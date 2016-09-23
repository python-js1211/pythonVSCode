/// <reference path="typings/index.d.ts" />

const transformime = require('transformime');
const MarkdownTransform = require('transformime-marked');
const transform = transformime.createTransform([MarkdownTransform]) as Function;

function displayData(data: any, whiteBg: boolean): Promise<HTMLElement> {
    if (typeof data['text/html'] === 'string') {
        data['text/html'] = data['text/html'].replace(/<\/scripts>/g, '</script>');
    }
    return transform(data).then(result => {
        // If dealing with images add them inside a div with white background
        if (whiteBg === true || Object.keys(data).some(key => key.startsWith('image/'))) {
            const div = document.createElement('div');
            div.style.backgroundColor = 'white';
            div.style.display = 'inline-block';
            div.appendChild(result.el);
            document.body.appendChild(div);
            return div;
        }
        else {
            document.body.appendChild(result.el);
            return result.el;
        }
    });
}

(window as any).initializeResults = (rootDirName: string, port: number, whiteBg: boolean) => {
    const results = (window as any).JUPYTER_DATA as any[];
    (window as any).__dirname = rootDirName;
    try {
        if (typeof port === 'number' && port > 0) {
            var socket = (window as any).io.connect('http://localhost:' + port);
            socket.on('results', function (results: any[]) {
                const promises = results.map(data => displayData(data, whiteBg));
                Promise.all<HTMLElement>(promises).then(elements => {
                    // Bring the first item into view
                    if (elements.length > 0) {
                        elements[0].scrollIntoView(true);
                    }
                });
            });
        }
    }
    catch (ex) {
        const errorDiv = document.createElement('div');
        errorDiv.innerHTML = 'Initializing live updates for results failed with the following error:\n' + ex.message;
        errorDiv.style.color = 'red';
        document.body.appendChild(errorDiv);
    }

    const promises = results.map(data => displayData(data, whiteBg));
    Promise.all<HTMLElement>(promises).then(elements => {
        // Bring the first item into view
        if (elements.length > 0) {
            elements[0].scrollIntoView(true);
        }
    });
};
