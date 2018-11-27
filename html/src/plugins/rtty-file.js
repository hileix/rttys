const magic_start = [82, 70];   /* 'R' 'F' */
const magic_r = [82, 70, 0, 9, 114, 102]; /* 'R' 'F' 0 9 'r' 'f' */
const magic_s = [82, 70, 0, 9, 115, 102]; /* 'R' 'F' 0 9 's' 'f' */
const blk_size = 16384;         /* 16KB */
let aborted = false;
let file_buffer = [];
let cache = [];
let file_name;
let file_size;
let file_offset;
let bad_recv = false;
let ws;

function find_subarray(haystack, needle) {
    let h = 0, n;

    while (h != -1) {
        h = haystack.indexOf(needle[0], h);
        if (h == -1)
            return -1;

        for (n = 1; n < needle.length; n++) {
            if (haystack[h + n] != needle[n]) {
                h++;
                break;
            }
        }

        if (n == needle.length)
            return h;
    }

    return -1;
}

function sendInfo(file) {
    let b = Buffer.alloc(6 + file.name.length);

    b[0] = 0x01;    /* packet type: file info */
    b[1] = file.name.length;
    b.write(file.name, 2);
    b.writeUInt32BE(file.size, 2 + file.name.length);
    ws.send(b);
}

function sendData(data) {
    let b = Buffer.alloc(3);
    let piece = new Uint8Array(data);

    b[0] = 0x02;    /* packet type: file data */
    b.writeUInt16BE(piece.length, 1);
    ws.send(b);
    ws.send(piece);
}

function sendEof() {
    let b = Buffer.alloc(1);
    b[0] = 0x03;    /* packet type: file eof */
    ws.send(b);
}

function abort() {
    aborted = true;
}

function readFile(file, fr, offset, size) {
    let blob = file.slice(offset, offset + size);
    fr.readAsArrayBuffer(blob);
}

function sendFile(file, opt) {
    let reader = new FileReader();

    ws = opt.ws;
    aborted = false;

    let offset = 0;

    sendInfo(file);

    reader.onload = (e) => {
        
        sendData(e.target.result);

        offset += e.loaded;

        if (!aborted && offset < file.size) {
            readFile(file, reader, offset, blk_size);
            return;
        }

        sendEof();

        opt.onFinish()
    };

    readFile(file, reader, offset, blk_size);
}

function abortRecv() {
    bad_recv = true;
    sendEof();
    console.log('abort recv');
}

function recvFile(input, opt) {
    input = Array.prototype.slice.call(new Uint8Array(input));
    cache.push.apply(cache, input);

    while (cache.length > 0) {
        let type = cache[0];

        console.log('type:' + type);

        switch (type) {
        case 0x01:  /* file info */
            if (cache.length < 2)
                return;
            let nl = cache[1];
            if (cache.length < nl + 2)
                return;
            cache.splice(0, 2);

            file_name = Buffer.from(cache.splice(0, nl)).toString();
            file_size = Buffer.from(cache.splice(0, 4)).readUInt32BE(0);
            file_offset = 0;
            file_buffer = [];
            bad_recv = false;
            ws = opt.ws;
            console.log('name:' + file_name);
            console.log('size:' + file_size);
            break;
        case 0x02:  /* file data */
            if (cache.length < 3)
                return;
            let dl = Buffer.from(cache.slice(1,3)).readUInt16BE(0);
            if (cache.length < dl + 3)
                return;
            cache.splice(0, 3);
            file_buffer.push(new Uint8Array(cache.splice(0, dl)));
            file_offset += dl;
            opt.on_progress(file_offset, file_size);
            break;
        case 0x03:  /* file eof */
            cache = [];

            opt.on_eof();

            if (bad_recv)
                return;

            let blob = new Blob(file_buffer);
            let url = URL.createObjectURL(blob);

            let el = document.createElement("a");
            el.style.display = "none";
            el.href = url;
            el.download = file_name;
            document.body.appendChild(el);
            el.click();
            document.body.removeChild(el);
            break;
        }
    }
}

function detect(input) {
    let type = '';

    if (!(input instanceof Array))
        input = Array.prototype.slice.call(new Uint8Array(input));

    cache.push.apply(cache, input);

    let pos = find_subarray(cache, magic_start);
    if (pos < 0) {
        cache = cache.splice(-6);
        return false;
    }
    
    pos = find_subarray(cache, magic_r);
    if (pos < 0) {
        pos = find_subarray(cache, magic_s);
        if (pos < 0) {
            cache = cache.splice(-magic.length);
            return false;
        }
        type = 's';
    } else {
        type = 'r';
    }

    cache = [];

    return type;
}

export default {
    detect: detect,
    sendFile: sendFile,
    sendEof: sendEof,
    abort: abort,
    recvFile: recvFile,
    abortRecv: abortRecv
};