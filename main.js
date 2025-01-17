/**
 * @name Linux File Manager
 * @version 1.004 -
 */

// Import the required modules
const { app, BrowserWindow, ipcMain, nativeImage, shell, screen, Menu, MenuItem, systemPreferences, dialog, clipboard } = require('electron');
const util = require('util')
const nativeTheme = require('electron').nativeTheme
const exec = util.promisify(require('child_process').exec)
const { execSync } = require('child_process')
const window = require('electron').BrowserWindow;
const windows = new Set();
const fs = require('fs')
const path = require('path');
const { Worker } = require('worker_threads');
const gio_utils = require('./utils/gio');
// const gio = require('node-gio')
const gio = require('./gio/build/Release/gio');
const mt = require('mousetrap');

// Workers
const worker = new Worker(path.join(__dirname, 'workers/worker.js'));
const ls = new Worker(path.join(__dirname, 'workers/ls.js'));
const thumb = new Worker(path.join(__dirname, 'workers/thumbnailer.js'));
const find = new Worker(path.join(__dirname, 'workers/find.js'));

const home = app.getPath('home');

// Monitor USB Devices
gio.monitor(data => {
    if (data) {
        // console.log(data)
        win.send('get_devices');
    }
});

let win;
let connect_win;
let window_id = 0;
let window_id0 = 0;
let is_main = 1;
let watcher_failed = 0;
let progress_id = 0;
let is_active = 0;

let selected_files_arr = []

class FileManager {

    constructor() {
        let source0 = '';
    }

    // Get files array
    get_files(source, tab) {

        watcher_failed = 1;
        try {
            gio.watcher(source, (watcher) => {
                watcher_failed = 0;
                if (watcher.event !== 'unknown') {
                    if (watcher.event === 'deleted') {
                        win.send('remove_card', watcher.filename);
                    }
                    if (watcher.event === 'created') {
                        try {
                            // console.log(watcher.event, watcher.filename);
                            let file = gio.get_file(watcher.filename);
                            win.send('get_card_gio', file);
                            if (file.is_dir) {
                                win.send('get_folder_count', watcher.filename);
                                win.send('get_folder_size', watcher.filename);
                            }
                        } catch (err) {
                            console.log(err)
                        }
                    }

                    win.send('clear_folder_size', path.dirname(watcher.filename));
                    get_disk_space(source);
                }
            })
        } catch (err) {
            // console.log('watcher err', err.message);
            win.send('msg', err);
            watcher_failed = 1;
        }

        // Call create thumbnails
        let thumb_dir = path.join(app.getPath('userData'), 'thumbnails');
        if (source.indexOf('mtp') > -1 || source.indexOf('thumbnails') > -1) {
            thumb.postMessage({ cmd: 'create_thumbnail', source: source, destination: thumb_dir, sort: sort });
        } else {
            thumb.postMessage({ cmd: 'create_thumbnail', source: source, destination: thumb_dir, sort: sort });
        }

        // Call ls worker to get file data
        ls.postMessage({ cmd: 'ls', source: source, tab: tab });

        get_disk_space(source);

        this.source0 = source;

    }
}

class Utilities {

    // Check if executable exists
    checkExec (executable) {
        try {
            let cmd = `which ${executable}`;
            let res = execSync(cmd).toString().trim();
            if (res) {
                return true;
            } else {
                return false;
            }

        } catch (err) {
            return false;
        }
    }

}

class watcher {

    constructor() {

        /**
         * Watch for theme changes
         */
        gio.on_theme_change(() => {
            win.webContents.reloadIgnoringCache();
            win.reload();
        })

    }

};

class Dialogs {

    constructor() {

        ipcMain.on('columns_menu', (e) => {
            const menu_template = [
                {
                    label: 'Columns',
                    click: () => {
                        this.Columns();
                    }
                }
            ]

            const menu = Menu.buildFromTemplate(menu_template)
            menu.popup(BrowserWindow.fromWebContents(e.sender))

        })

    }

    Columns() {
        let bounds = win.getBounds()

        let x = bounds.x + parseInt((bounds.width - 400) / 2);
        let y = bounds.y + parseInt((bounds.height - 350) / 2);


        let dialog = new BrowserWindow({
            parent: window.getFocusedWindow(),
            width: 400,
            height: 350,
            backgroundColor: '#2e2c29',
            x: x,
            y: y,
            frame: true,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
            },
        })

        dialog.loadFile(path.join(__dirname, 'dialogs', 'columns.html'))
        // dialog.webContents.openDevTools()

        // SHOW DIALG
        dialog.once('ready-to-show', () => {
            dialog.removeMenu()
            dialog.send('columns')
        })
    }

}

class SettingsManager {

    constructor() {

        this.settings = {};
        this.settings_file = path.join(app.getPath('userData'), 'settings.json');

        this.window_file = path.join(app.getPath('userData'), 'window.json');
        this.window_settings = {
            window: {
                width: 1024,
                height: 600,
                x: 0,
                y: 0
            }
        };

        ipcMain.on('show_menubar', (e) => {
            this.getSettings();
            this.showMenubar();
        })

    }

    // Get Settings
    getSettings() {
        try {
            setTimeout(() => {
                this.checkSettings();
            }, 500);
            this.settings = JSON.parse(fs.readFileSync(this.settings_file), 'utf-8');
        } catch (err) {
            fs.copyFileSync(path.join(__dirname, 'assets/config/settings.json'), this.settings_file);
            this.settings = JSON.parse(fs.readFileSync(this.settings_file), 'utf-8');
        }
        return this.settings;
    }

    // Check if old settings
    checkSettings() {
        // Read the content of the first JSON file
        const file1 = fs.readFileSync(this.settings_file);
        const json1 = JSON.parse(file1);

        let f2 = gio.get_file(path.join(__dirname, '/assets/config/settings.json'));
        let f1 = gio.get_file(this.settings_file);

        if (f2.mtime > f1.mtime) {

            // Read the content of the second JSON file
            const file2 = fs.readFileSync(path.join(__dirname, '/assets/config/settings.json'));
            const json2 = JSON.parse(file2);

            // Update json1 with changes from json2
            Object.assign(json1, json2);

            // Write the updated JSON to the first file
            // fs.writeFileSync(this.settings_file, JSON.stringify(json2, null, 4));
            this.updateSettings(json2);

        }
    }

    // Update settings
    updateSettings(settings) {
        try {
            fs.writeFileSync(this.settings_file, JSON.stringify(settings, null, 4));
        } catch (err) {
            console.log(err)
        }
        this.settings = settings;
    }

    // Toggle Menubar
    showMenubar() {
        let showMenubar = this.settings['File Menu']['show'];
        console.log(showMenubar);
        if (showMenubar) {
            win.setMenuBarVisibility(true);
        } else {
            win.setMenuBarVisibility(false);
        }
    }

    getWindowSetting() {
        try {
            this.window_settings = JSON.parse(fs.readFileSync(this.window_file, 'utf-8'));
        } catch (err) {
            fs.writeFileSync(this.window_file, JSON.stringify(this.window_settings, null, 4));
        }
        return this.window_settings;
    }

    updateWindowSettings(window_settings) {
        this.window_settings = window_settings;
        fs.writeFileSync(this.window_file, JSON.stringify(this.window_settings, null, 4));
    }

}

class IconManager {

    constructor() {
    }

    /**
     *
     * @returns {string} folder_icon_path
     */
    getFolderIcon() {
        let icon_theme = execSync('gsettings get org.gnome.desktop.interface icon-theme').toString().replace(/'/g, '').trim();
        let icon_dir = path.join(__dirname, 'assets', 'icons');
        try {
            let search_path = [];
            search_path.push(path.join(home, '.local/share/icons'),
                path.join(home, '.icons'),
                '/usr/share/icons')

            search_path.every(icon_path => {
                let theme_path = path.join(icon_path, icon_theme);
                // console.log(theme_path)
                if (fs.existsSync(theme_path)) {
                    icon_dir = path.join(icon_path, icon_theme);
                    return false;
                } else {
                    icon_dir = path.join(__dirname, 'assets', 'icons', 'kora');
                    return true;
                }
            })
            let folder_icon_path = ''
            let icon_dirs = [
                path.join(icon_dir, 'places@2x/48/'),
                path.join(icon_dir, '32x32/places/'),
                path.join(icon_dir, '64x64/places/'),
                path.join(icon_dir, 'places/scalable/'),
                path.join(icon_dir, 'scalable@2x/places/'),
                path.join(icon_dir, 'places/32/'),
                path.join(icon_dir, 'places/48/'),
                path.join(icon_dir, 'places/64/'),
                path.join(icon_dir, 'places/128/'),
                path.join(icon_dir, 'places/symbolic/')
            ];
            icon_dirs.every(icon_dir => {
                if (fs.existsSync(icon_dir)) {
                    folder_icon_path = icon_dir
                    return false;
                } else {
                    folder_icon_path = path.join(__dirname, 'assets/icons/')
                    return true;
                }
            })
            // console.log(folder_icon_path);
            return folder_icon_path;
        } catch (err) {
            console.log(err);
        }
    }

    getIcon(folder_path) {

        let icon = gio.get_icon(folder_path);
        return icon;

    }

}

const fileManager = new FileManager();
const utilities = new Utilities();
const theme_watcher = new watcher();
const dialogs = new Dialogs();
const settingsManger = new SettingsManager();
const iconManager = new IconManager();

let window_settings = settingsManger.getWindowSetting();
let settings = settingsManger.getSettings();

worker.postMessage({ cmd: 'monitor' });

let recent_files_path = path.join(app.getPath('userData'), 'recent_files.json');

// Set window id
ipcMain.on('active_window', (e) => {
    window_id0 = window_id
    window_id = e.sender.id;
    if (window_id != window_id0) {
        win = window.fromId(window_id);
    }
})

// Worker Threads ///////////////////////////////////////////

thumb.on('message', (data) => {
    if (data.cmd === 'msg') {
        win.send('msg', data.msg, data.has_timeout);
    }
    if (data.cmd === 'thumbnail_chunk_done') {
        win.send('get_thumbnail', data.href, data.thumbnail);
    }
    if (data.cmd === 'thumbnail_done') {
        win.send('msg', 'Done Creating Thumbnails', has_timeout = 1);
    }
})

find.on('message', (data) => {
    if (data.cmd === 'search_done') {
        win.send('search_results', data.results_arr);
    }
})

ls.on('message', (data) => {

    if (data.cmd === 'ls_err') {
        win.send('msg', data.err)
    }

    if (data.cmd === 'ls_done') {
        win.send('ls', data.dirents, data.source, data.tab);
    }

})

let progress_counter = 0;
worker.on('message', (data) => {

    switch (data.cmd) {
        case 'merge_files_move': {
            const is_move = 1;
            win.send("merge_files", data.merge_arr, is_move);
            data.merge_arr = [];
            break;
        }
        case 'merge_files': {
            win.send("merge_files", data.merge_arr);
            data.merge_arr = [];
            break;
        }
        case 'folder_size': {
            win.send('folder_size', data.source, data.size);
            break;
        }
        case 'folder_count': {
            win.send('folder_count', data.source, data.folder_count);
            break;
        }
        case 'confirm_overwrite': {
            overWriteNext(data.copy_overwrite_arr);
            // confirmOverwrite(data.source, data.destination, data.copy_overwrite_arr);
            break;
        }
        case 'msg': {
            win.send('msg', data.msg, data.has_timeout);
            break;
        }
        case 'move_done': {

            // Handle Cut / Move
            if (is_main && watcher_failed) {
                let file = gio.get_file(data.destination);
                win.send('get_card_gio', file);
            } else {
                win.send('get_folder_size', path.dirname(data.destination));
                win.send('remove_card', data.source);
            }

            win.send('lazyload');
            win.send('clear');
            break;
        }
        case 'rename_done': {
            console.log('rename_done');
            if (watcher_failed) {
                win.send('remove_card', data.source);
                let file = gio.get_file(data.destination);
                win.send('get_card_gio', file);
            }
            break;
        }
        case  'mkdir_done': {

            if (is_main && watcher_failed) {
                try {
                    let file = gio.get_file(data.destination);
                    file.is_new_folder = 1;
                    win.send('get_card_gio', file);
                } catch (err) {
                    console.log(err);
                }

            } else if (!is_main && watcher_failed) {
                try {
                    let href = path.dirname(data.destination)
                    let file = gio.get_file(href)
                    win.send('replace_card', href, file);
                } catch (err) {
                    console.log(err);
                }

            }
            break;
        }
        case  'copy_done': {
            if (is_main) {
                if (watcher_failed) {
                    let file = gio.get_file(data.destination);
                    win.send('get_card_gio', file);
                }
            } else {
                if (!is_main) {
                    win.send('get_folder_count', path.dirname(data.destination));
                    win.send('get_folder_size', path.dirname(data.destination));
                }
            }

            win.send('lazyload');
            win.send('clear');
            break;
        }
        case  'cp_template_done': {
            if (is_main) {
                // if (watcher_failed) {
                    let file = gio.get_file(data.destination);
                    win.send('get_card_gio', file);
                    win.send('edit', data.destination);
                // }
                break;
            }

        }
        case  'delete_done': {
            win.send('remove_card', data.source);
            win.send('msg', `Deleted "${path.basename(data.source)}"`);
            break;
        }f
        case 'progress': {
            win.send('set_progress', data)
            if (data.value == data.max) {
                progress_counter = 0;
            }
            break;
        }
        case 'show_loader': {
            win.send('show_loader');
            break;
        }
        case 'hide_loader': {
            win.send('hide_loader');
            break;
        }
        case 'count': {
            win.send('count', data.source, data.count);
            break;
        }
        case  'folder_size_done': {
            win.send('folder_size', data.source, data.folder_size);
            break;
        }
        case 'properties': {
            win.send('properties', data.properties_arr);
            break;
        }

    }

    // if (data.cmd === 'merge_files_move') {
    //     const is_move = 1;
    //     win.send("merge_files", data.merge_arr, is_move);
    //     data.merge_arr = [];
    // }

    // if (data.cmd === 'merge_files') {
    //     win.send("merge_files", data.merge_arr);
    //     data.merge_arr = [];
    // }

    // if (data.cmd === 'folder_size') {
    //     win.send('folder_size', data.source, data.size);
    // }

    // if (data.cmd === 'folder_count') {
    //     win.send('folder_count', data.source, data.folder_count)
    // }

    // if (data.cmd === 'confirm_overwrite') {
    //     overWriteNext(data.copy_overwrite_arr);
    //     // confirmOverwrite(data.source, data.destination, data.copy_overwrite_arr);
    // }

    // if (data.cmd === 'msg') {
    //     win.send('msg', data.msg, data.has_timeout);
    // }

    // if (data.cmd === 'move_done') {

    //     // Handle Cut / Move
    //     if (is_main && watcher_failed) {
    //         let file = gio.get_file(data.destination);
    //         win.send('get_card_gio', file);
    //     } else {
    //         win.send('get_folder_size', path.dirname(data.destination));
    //         win.send('remove_card', data.source);
    //     }

    //     win.send('lazyload');
    //     win.send('clear');
    // }

    // if (data.cmd === 'rename_done') {
    //     console.log('rename_done');
    //     if (watcher_failed) {
    //         win.send('remove_card', data.source);
    //         let file = gio.get_file(data.destination);
    //         win.send('get_card_gio', file);
    //     }
    // }

    // if (data.cmd === 'mkdir_done') {

    //     if (is_main && watcher_failed) {
    //         try {
    //             let file = gio.get_file(data.destination);
    //             file.is_new_folder = 1;
    //             win.send('get_card_gio', file);
    //         } catch (err) {
    //             console.log(err);
    //         }

    //     } else if (!is_main && watcher_failed) {
    //         try {
    //             let href = path.dirname(data.destination)
    //             let file = gio.get_file(href)
    //             win.send('replace_card', href, file);
    //         } catch (err) {
    //             console.log(err);
    //         }

    //     }
    // }

    // if (data.cmd === 'copy_done') {
    //     if (is_main) {
    //         if (watcher_failed) {
    //             let file = gio.get_file(data.destination);
    //             win.send('get_card_gio', file);
    //         }
    //     } else {
    //         if (!is_main) {
    //             win.send('get_folder_count', path.dirname(data.destination));
    //             win.send('get_folder_size', path.dirname(data.destination));
    //         }
    //         // let href = path.dirname(data.destination)
    //         // let file = gio.get_file(href)
    //         // win.send('replace_card', href, file);
    //     }

    //     win.send('lazyload');
    //     win.send('clear');
    // }

    // if (data.cmd === 'cp_template_done') {
    //     if (is_main) {
    //         // if (watcher_failed) {
    //             let file = gio.get_file(data.destination);
    //             win.send('get_card_gio', file);
    //             win.send('edit', data.destination);
    //         // }
    //     }

    //     // else {
    //     //     if (!is_main) {
    //     //         win.send('get_folder_count', path.dirname(data.destination));
    //     //         win.send('get_folder_size', path.dirname(data.destination));
    //     //     }
    //     //     // let href = path.dirname(data.destination)
    //     //     // let file = gio.get_file(href)
    //     //     // win.send('replace_card', href, file);
    //     // }

    //     // win.send('lazyload');
    //     // win.send('clear');
    // }

    // if (data.cmd === 'delete_done') {
    //     win.send('remove_card', data.source);
    //     win.send('msg', `Deleted "${path.basename(data.source)}"`)
    // }

    // if (data.cmd === 'progress') {
    //     // progress_counter++
    //     // let msg = data.msg;
    //     // let max = data.max;
    //     // let value = data.value;
    //     // win.send('set_progress', { value: value, max: max, msg: msg })
    //     win.send('set_progress', data)
    //     if (data.value == data.max) {
    //         progress_counter = 0;
    //     }
    // }

    // if (data.cmd === 'show_loader') {
    //     win.send('show_loader')
    // }

    // if (data.cmd === 'hide_loader') {
    //     win.send('hide_loader')
    // }

    // if (data.cmd === 'count') {
    //     win.send('count', data.source, data.count)
    // }

    // if (data.cmd === 'folder_size_done') {
    //     win.send('folder_size', data.source, data.folder_size);
    // }

})

// Functions //////////////////////////////////////////////

// Save Recent File

function get_properties (href) {
    if (href !== '/' && path.basename(href) !== 'Recent') {
        let selected_files_arr = [];
        console.log('get_properties', href);
        selected_files_arr.push(href);
        let cmd = {
            cmd: 'properties',
            selected_files_arr: selected_files_arr
        }
        worker.postMessage(cmd);
    } else {
        let msg = {
            msg: `Cannot get properties for ${href}`
        }
        win.send('msg', msg.msg);
    }
}

function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        gio.exec(cmd, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(res);
        });
    });
}

function saveRecentFile(href) {

    // Check if the file exists
    const fileExists = fs.existsSync(recent_files_path);
    let jsonData = [];

    if (fileExists) {
        // Read the existing JSON file
        const fileData = fs.readFileSync(recent_files_path, 'utf8');
        jsonData = JSON.parse(fileData);
    }

    // Add the new object to the data
    if (!jsonData) {
        jsonData = [];
    }

    let exists = 0;
    for (key in jsonData) {
        if (jsonData[key] === href) {
            exists = 1;
        }
    }

    if (!exists) {
        jsonData.push(href);
    }

    // Convert the data back to JSON format
    const updatedData = JSON.stringify(jsonData, null, 2); // null, 2 adds indentation for readability

    // Write the updated data to the file
    fs.writeFileSync(recent_files_path, updatedData, 'utf8');

}

// Get Recent Files
function getRecentFiles(callback) {
    fs.readFile(recent_files_path, 'utf-8', (err, data) => {
        if (err) {
            console.log(err);
            return;
        }
        let file_arr = []
        let json_data = JSON.parse(data);
        for (let key in json_data) {
            if (gio.exists(json_data[key])) {
                let file = gio.get_file(json_data[key]);
                file_arr.push(file);
            }
        }
        callback(file_arr);
        //     const recent_files = json_data.reduce((a, b) => {
        //         let existing_obj = a.find(obj => obj.href === b.href);
        //         if (!existing_obj) {
        //             a.push(b);
        //         }
        //         return a
        //     }, [])
        //     let recent_arr = recent_files.sort((a, b) => {
        //         return b.atime - a.atime;
        //     })
        //     return callback(recent_arr);
    })
}

function getSettings() {
    let settings_file = path.join(app.getPath('userData'), 'settings.json');
    let settings = {};
    try {
        settings = JSON.parse(fs.readFileSync(settings_file, 'utf-8'));
    } catch (err) {
        fs.copyFileSync(path.join(__dirname, 'assets/config/settings.json'), settings_file);
        settings = JSON.parse(fs.readFileSync(settings_file, 'utf-8'));
    }
    return settings;
}

// Get Folder Size
function getFolderSize(source, callback) {
    // let dirents = gio.ls(source)
    try {
        get_files_arr(source, '', dirents => {

            dirents.reduce((c, x) => x.type !== 'directory' ? c + 1 : c, 0); //dirents.filter(x => x.is_dir === true).length;
            let size = 0;
            for (let i = 0; i < dirents.length; i++) {
                if (dirents[i].type !== 'directory')
                    size += dirents[i].size
            }

            // dirents.reduce((c, x) => x.type === 'directory' ? c + 1 : c, 0); //dirents.filter(x => x.is_dir === true).length;
            // let folder_count = dirents.length;
            return callback(size);
        })
    } catch (err) {
        console.log(err);
    }
}

// Get Folder Count
function getFolderCount(source, callback) {
    // let dirents = gio.ls(source)
    try {
        get_files_arr(source, '', dirents => {
            // let folder_count = dirents.reduce((c, x) => x.type === 'directory' ? c + 1 : c, 0); //dirents.filter(x => x.is_dir === true).length;
            let folder_count = dirents.length;
            return callback(folder_count);
        })
    } catch (err) {

    }
}

// Get File Count
function getFileCount(source, callback) {
    try {
        get_files_arr(source, '', dirents => {
            let file_count = dirents.reduce((c, x) => x.is_dir === false ? c + 1 : c, 0); //dirents.filter(x => x.is_dir === true).length;
            return callback(file_count);
        })
    } catch (err) {

    }
}

// Get Disk Space
function get_disk_space(href) {

    try {

        let options = {
            disksize: getFileSize(parseInt(gio.du(href).total)),
            usedspace: getFileSize(parseInt(gio.du(href).used)),
            availablespace: getFileSize(parseInt(gio.du(href).free))
        }
        let df = [];
        df.push(options);
        win.send('disk_space', df);

    } catch (err) {

    }

}

function get_apps() {
    let exe_arr = [];
    gio.ls('/usr/share/applications', (err, data) => {

        if (err) {
            console.log('error:' + err)
        }

        data.forEach(item => {
            let content = fs.readFileSync(item.href, 'utf-8');
            let data = content.split('\n');

            let exe_obj = {};

            for (const line of data) {

                if (line.startsWith('Exec=')) {

                    let cmd = line.substring(5).trim();
                    const exe = cmd.split(' ')[0];

                    exe_obj.cmd = cmd;
                    exe_obj.exe = exe;

                }

                if (line.startsWith('Name=')) {
                    let name = line.substring(5).trim();
                    exe_obj.name = name;
                }

                if (line.startsWith('Type=')) {
                    let type = line.substring(5).trim();
                    exe_obj.type = type;
                }

            }

            exe_arr.push(exe_obj);

        })

    })
    const arr = exe_arr.reduce((accumulator, current) => {
        if (!accumulator.find((item) => item.exe === current.exe)) {
            accumulator.push(current);
        }
        return accumulator;
    }, []);
    return arr;
}

function new_folder(destination) {
    try {
        gio.mkdir(destination);
        win.send('get_card_gio', gio.get_file(destination));
        win.send('edit', destination);
    } catch (err) {
        win.send('msg', err);
    }
}

// function watch_for_theme_change() {
//     let watch_dir = path.join(path.dirname(app.getPath('userData')), 'dconf')
//     if (gio.exists(watch_dir)) {
//         let file = gio.get_file(watch_dir)
//         let fsTimeout
//         fs.watchFile(watch_dir, (e) => {
//             let file0 = gio.get_file(watch_dir)
//             if (file0.mtime > file.mtime) {
//                 win.webContents.reloadIgnoringCache();
//                 fsTimeout = setTimeout(function () {
//                     fsTimeout = null
//                 }, 5000)
//             }
//         })
//     } else {
//         // console.log('error getting gnome settings directory')
//     }
// }

function getFileSize(fileSizeInBytes) {
    var i = -1;
    var byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
    do {
        fileSizeInBytes = fileSizeInBytes / 1024;
        i++;
    } while (fileSizeInBytes > 1024);
    return Math.max(fileSizeInBytes, 0.1).toFixed(1) + byteUnits[i];
};

let file_arr = [];
let cp_recursive = 0;
function get_files_arr(source, destination, callback) {
    cp_recursive++
    file_arr.push({ type: 'directory', source: source, destination: destination })
    gio.ls(source, (err, dirents) => {
        for (let i = 0; i < dirents.length; i++) {
            let file = dirents[i]
            if (file.is_dir) {
                get_files_arr(file.href, path.format({ dir: destination, base: file.name }), callback)
            } else {
                let src = file.href;
                let dest = path.format({ dir: destination, base: file.name });

                if (gio.exists(dest)) {

                    let f1 = gio.get_file(src);
                    let f2 = gio.get_file(dest);

                    if (f1.mtime < f2.mtime) {
                        file_arr.push({
                            type: 'file',
                            source: src,
                            destination: dest,
                            size: file.size,
                        })
                    }

                } else {
                    file_arr.push({
                        type: 'file',
                        source: src,
                        destination: dest,
                        size: file.size,
                    })
                }

            }
        }
        if (--cp_recursive == 0) {
            let file_arr1 = file_arr;
            file_arr = []
            return callback(file_arr1);

        }
    })
}

// // Get files array
// function get_files(source, tab) {

//     watcher_failed = 1;
//     try {
//         gio.watcher(source, (watcher) => {
//             watcher_failed = 0;
//             if (watcher.event !== 'unknown') {
//                 if (watcher.event === 'deleted') {
//                     win.send('remove_card', watcher.filename);
//                 }
//                 if (watcher.event === 'created') {
//                     try {
//                         // console.log(watcher.event, watcher.filename);
//                         let file = gio.get_file(watcher.filename);
//                         win.send('get_card_gio', file);
//                         if (file.is_dir) {
//                             win.send('get_folder_count', watcher.filename);
//                             win.send('get_folder_size', watcher.filename);
//                         }
//                     } catch (err) {
//                         console.log(err)
//                     }
//                 }

//                 win.send('clear_folder_size', path.dirname(watcher.filename));
//                 get_disk_space(source);
//             }
//         })
//     } catch (err) {
//         // console.log('watcher err', err.message);
//         win.send('msg', err);
//         watcher_failed = 1;
//     }

//     // Call create thumbnails
//     let thumb_dir = path.join(app.getPath('userData'), 'thumbnails');
//     if (source.indexOf('mtp') > -1 || source.indexOf('thumbnails') > -1) {
//         thumb.postMessage({ cmd: 'create_thumbnail', source: source, destination: thumb_dir, sort: sort });
//     } else {
//         thumb.postMessage({ cmd: 'create_thumbnail', source: source, destination: thumb_dir, sort: sort });
//     }

//     // Call ls worker to get file data
//     ls.postMessage({ cmd: 'ls', source: source, tab: tab });

//     get_disk_space(source);

// }

function copyOverwrite(copy_overwrite_arr) {
    copy_overwrite_arr.every(item => {
        gio_utils.get_file(item.source, source_file => {

            gio_utils.get_file(item.destination, destination_file => {
                confirmOverwrite(source_file, destination_file);
            })

        })

    })
}

// IPC ////////////////////////////////////////////////////
/** */

// Add history
ipcMain.on('add_history', (e, location) => {

    let history_file = path.join(app.getPath('userData'), 'history.json');
    let history_data = [];
    if (!gio.exists(history_file)) {
        fs.writeFileSync(history_file, JSON.stringify(history_data, null, 4));
    }
    history_data = JSON.parse(fs.readFileSync(history_file, 'utf8'));
    for (let i = 0; i < history_data.length; i++) {
        if (history_data[i] === location) {
            history_data.splice(i, 1);
        }
    }
    history_data.push(location)
    fs.writeFileSync(history_file, JSON.stringify(history_data, null, 4));

})

// // Remove history
// ipcMain.on('remove_history', (e, href) => {
//     let history_file = path.join(app.getPath('userData'), 'history.json');
//     let history_data = JSON.parse(fs.readFileSync(history_file, 'utf8'));
//     let history = history_data.filter(data => data.href !== href);
//     fs.writeFileSync(history_file, JSON.stringify(history, null, 4));
//     win.send('get_history');
//     selected_files_arr = [];
// })

// Get history
ipcMain.handle('get_history', async (e) => {

    let history_file = path.join(app.getPath('userData'), 'history.json');
    if (!gio.exists(history_file)) {
        let history_data = [];
        fs.writeFileSync(history_file, JSON.stringify(history_data, null, 4));
    }
    let history_items = JSON.parse(fs.readFileSync(history_file, 'utf-8'));
    return history_items;

})

ipcMain.handle('file_exists', (e, href) => {
    return fs.existsSync(href);
})

let autocomplete_arr = [];
ipcMain.handle('autocomplete', async (e, directory) => {

    // let autocomplete_arr;
    // let dir = path.dirname(directory);
    // let search = path.basename(directory);

    // try {
    //     await gio.ls(directory, (err, dirents) => {
    //         if (err) {
    //             return;
    //         }
    //         let dir_arr = [];
    //         dirents.forEach(item => {
    //             if (item.is_dir) {
    //                 dir_arr.push(item.href);
    //             }
    //         })
    //         autocomplete_arr = dir_arr;
    //     })

    // } catch (err) {

    // }

    // let filter = autocomplete_arr.filter(item => item.startsWith(directory));
    // return filter;

    let autocomplete_arr = [];
    let dir = path.dirname(directory);
    let search = path.basename(directory);

    try {
        await gio.ls(dir, (err, dirents) => {
            if (err) {
                return;
            }
            dirents.forEach(item => {
                if (item.is_dir && item.name.startsWith(search)) {
                    autocomplete_arr.push(item.href + '/');
                }
            })
        })

    } catch (err) {

    }
    return autocomplete_arr;
})

ipcMain.on('columns', (e) => {
    dialogs.Columns();
})

// Promise function for find command
// function findCommand(cmd) {
//     return new Promise((resolve, reject) => {
//         gio.exec(cmd, (err, res) => {
//             if (err) {
//                 reject(err);
//                 return;
//             }
//             resolve(res);
//         });
//     });
// }

// Find command
ipcMain.handle('find', async (e, cmd) => {

    try {
        const res = execPromise(cmd);
        return res;
    } catch (err) {
        win.send('msg', err);
        throw err;
    }

})

ipcMain.handle('df', async (e) => {
    const { stdout, stderr } = await exec('df');
    if (stdout) {
        return stdout.toString().split('\n');
    }
    if (stderr) {
        return stderr;
    }
    // const {stdout, stderr} = await exec('df').toString().split('\n');
})

ipcMain.on('set_execute', (e, href) => {
    gio.set_execute(href);
})

ipcMain.on('clear_execute', (e, href) => {
    gio.clear_execute(href);
})

// Get templates path
ipcMain.handle('get_templates_folder', (e) => {
    return path.join(home, 'Templates');
})

// Get Files Array
ipcMain.on('get_files_arr_merge', (e, source, destination, copy_arr) => {
    worker.postMessage({ 'cmd': 'merge_files', source: source, destination: destination, copy_arr: copy_arr });
})

// Get home directory
ipcMain.handle('home', (e) => {
    return home;
})

// Write find page
ipcMain.on('save_find', (e, data) => {
    fs.writeFileSync(path.join(__dirname, 'src/find.html'), data);
})

//
ipcMain.handle('nav_item', (e, dir) => {
    // Handle special dirs
    switch (dir) {
        case 'Home': {
            dir = home;
            break;
        }
        case '/': {
            dir = '/';
            break;
        }
        default: {
            dir = path.join(home, dir);
        }
    }

    return dir;
})

// New Folder
ipcMain.on('new_folder', (e, destination) => {

    let folder_path = `${path.format({ dir: destination, base: 'New Folder' })}`
    new_folder(folder_path);
    // try {
    //     gio.mkdir(folder_path)
    // } catch (err) {
    //     win.send('msg', err.message);
    // }
    // win.send('get_card_gio', folder_path);
})

// Extract
ipcMain.on('extract', (e, location) => {

    for (let i = 0; i < selected_files_arr.length; i++) {

        let worker = new Worker(path.join(__dirname, './workers/worker.js'));
        worker.on('message', (data) => {

            // console.log('extract cmd', data.cmd);

            if (data.cmd === 'msg') {
                win.send('msg', data.msg, data.has_timeout);
            }

            if (data.cmd === 'progress') {
                win.send('set_progress', data)
            }

            if (data.cmd === 'extract_done') {
                let close_progress = {
                    id: data.id,
                    value: 0,
                    max: 0,
                    msg: ''
                }
                win.send('set_progress', close_progress);

                win.send('remove_card', data.destination);
                win.send('get_card_gio', gio.get_file(data.destination));

            }
        })

        let data = {
            id: progress_id += 1,
            cmd: 'extract',
            location: location,
            source: selected_files_arr[i],
        }
        worker.postMessage(data);

    }
    selected_files_arr = [];
})

// Compress
ipcMain.on('compress', (e, location, type, size) => {

    let worker = new Worker(path.join(__dirname, './workers/worker.js'));
    worker.on('message', (data) => {

        // console.log('compress cmd', data.cmd);

        if (data.cmd === 'msg') {
            win.send('msg', data.msg, data.has_timeout);
        }
        if (data.cmd === 'progress') {
            win.send('set_progress', data)
        }
        if (data.cmd === 'compress_done') {
            // win.send('msg', 'Done Compressing Files', 1);
            win.send('remove_card', data.file_path);
            win.send('get_card_gio', gio.get_file(data.file_path));
            let close_progress = {
                id: data.id,
                value: 1,
                max: 0,
                msg: ''
            }
            win.send('set_progress', close_progress);
        }
    })

    let compress_data = {
        id: progress_id += 1,
        cmd: 'compress',
        location: location,
        type: type,
        size: size,
        files_arr: selected_files_arr
    }
    worker.postMessage(compress_data);

})

// Path Utilities //////////////////////////////////
// **

// Join

ipcMain.handle('path:extname', (e, href) => {
    return path.extname(href)
})

ipcMain.handle('path:join', (e, dir) => {
    return path.join(__dirname, dir)
})

// Path Format
ipcMain.handle('path:format', (e, dir, base) => {
    return path.format({ dir: dir, base: path.basename(base) });
})

// Dirname
ipcMain.handle('dirname', (e, source) => {
    return path.dirname(source);
})

// Get path
ipcMain.handle('basename', (e, source) => {
    return path.basename(source);
})

////////////////////////////////////////////////////
/** */

ipcMain.on('get_view', (e, location) => {
    win.send('get_view', location);
})

ipcMain.on('merge_files_confirmed', (e, filter_merge_arr, is_move) => {

    progress_id += 1;
    progress_counter = 1;
    merge_err_arr = [];
    filter_merge_arr.forEach((item, i) => {
        action = parseInt(item.action);
        if (action === 1) {
            try {
                gio.cp(item.source, item.destination, 1);
                if (is_move) {
                    gio.rm(item.source);
                }
            } catch (err) {

                merge_err_arr.push(err.message);

                win.send('msg', err.message, 1);

                let progress_done = {
                    id: progress_id,
                    value: 0,
                    max: 0,
                    msg: ''
                }
                win.send('set_progress', progress_done);
                // return;
            }
        } else if (action === 2) {
            try {
                let destination_dir = path.dirname(item.destination);
                if (!gio.exists(destination_dir)) {
                    gio.mkdir(destination_dir);
                }
                gio.cp(item.source, item.destination, 1);
                if (is_move) {
                    gio.rm(item.source);
                }
            } catch (err) {

                merge_err_arr.push(err.message);

                win.send('msg', err.message, 1);
                let progress_done = {
                    id: progress_id,
                    value: 0,
                    max: 0,
                    msg: ''
                }
                win.send('set_progress', progress_done);
                // return;
            }
        }

        let progress = {
            id: progress_id,
            value: i + 1,
            max: filter_merge_arr.length,
            msg: `Copying ${i + 1} of ${filter_merge_arr.length}`
        }
        win.send('set_progress', progress);

        if (i == filter_merge_arr.length - 1) {
            let progress_done = {
                id: progress_id,
                value: 0,
                max: 0,
                msg: ''
            }
            win.send('set_progress', progress_done);
            win.send('done_merging_files', merge_err_arr);
        }
    })

})

// ipcMain.on('umount', (e, uuid) => {
//     gio.umount(uuid)
// })

ipcMain.on('mount', (e, device) => {

    let cmd = '';
    if (device.uuid != '') {
        cmd = `gio mount -d ${device.uuid}`
    } else if (device.root != '') {
        cmd = `gio mount ${device.root}`
    }

    if (cmd != '') {
        exec(cmd, (err, stderr, stdout) => {
            if (err) {
                // win.send('msg', err);
                return;
            }
            // win.send('get_view', location);
        });
    } else {
        win.send('msg', 'Device Error: No UUID or Activation path found');
    }


})

ipcMain.on('umount', (e, href) => {
    exec(`gio mount -u -f ${href}`, (err, stderr, stdout) => {
        if (err) {
            win.send('msg', err);
        }
    });
})

// Search Results
ipcMain.on('search_results', (e, search_arr) => {
    let arr = []
    search_arr.forEach(item => {
        try {
            arr.push(gio.get_file(item));
        } catch (err) {
        }
    })
    win.send('search_results', (e, arr))
})

// Run external command
ipcMain.on('command', (e, cmd) => {
    exec(cmd, (error, data, getter) => { });
})

ipcMain.on('connect_dialog', (e) => {
    connectDialog();
})

// Connect
ipcMain.handle('connect', async (e, cmd) => {

    let msg = {
        message: '',
        error: 0
    }

    // const { stdout, stderr } = await exec(cmd);
    if (cmd.type.toLocaleLowerCase() === 'sshfs') {
        let sshfs_cmd = `sshfs ${cmd.username}@${cmd.server}:/ ${cmd.mount_point}`;
        try {
            execSync(sshfs_cmd);
            msg.message = `Connected to ${cmd.server}`;
            msg.error = 0;
            connect_win.send('msg_connect', msg);
        } catch (err) {
            console.log(err);
            msg.message = err.message;
            msg.error = 1;
            connect_win.send('msg_connect', msg);
        }
    } else {
        gio.connect_network_drive(cmd.server, cmd.username, cmd.password, cmd.use_ssh_key, (error) => {
            console.log(error);
            if (error) {
                msg.message = error.message;
                msg.error = 1;
                connect_win.send('msg_connect', msg);
            } else {
                msg.message = `Connected to ${cmd.server}`;
                msg.error = 0;
                connect_win.send('msg_connect', msg);
            }
        });
    }

})

// Get folder icon
ipcMain.on('get_folder_icon', (e, folder_path) => {
    let icon = gio.get_icon(folder_path);
})

// Icon Theme
ipcMain.handle('folder_icon', (e) => {
    return iconManager.getFolderIcon();
})

// Get Writable Theme
ipcMain.handle('writable_icon', (e) => {
    let icon_theme = execSync('gsettings get org.gnome.desktop.interface icon-theme').toString().replace(/'/g, '').trim();
    let icon_dir = path.join(__dirname, 'assets', 'icons');
    try {
        let search_path = [];
        search_path.push(path.join(home, '.local/share/icons'), path.join(home, '.icons'), '/usr/share/icons');
        search_path.every(icon_path => {
            if (fs.existsSync(path.join(icon_path, icon_theme))) {
                icon_dir = path.join(icon_path, icon_theme);

                return false;
            } else {
                icon_dir = path.join(__dirname, 'assets', 'icons');
                return true;
            }
        })
        let folder_icon_path = ''
        let icon_dirs = [path.join(icon_dir, 'emblems@2x/16/emblem-readonly.svg'), path.join(icon_dir, '16x16/emblems/emblem-readonly.svg'), path.join(icon_dir, 'emblems/scalable/emblem-readonly.svg'), path.join(icon_dir, 'emblems/16/emblem-readonly.svg')];
        icon_dirs.every(icon_dir => {
            if (fs.existsSync(icon_dir)) {
                folder_icon_path = icon_dir
                return false;
            } else {
                folder_icon_path = path.join(__dirname, 'assets/icons/emblem-readonly.svg')
                return true;
            }
        })
        return folder_icon_path;
    } catch (err) {
        console.log(err);
    }
})

// Get Symlink Theme
ipcMain.handle('symlink_icon', (e) => {
    let icon_theme = execSync('gsettings get org.gnome.desktop.interface icon-theme').toString().replace(/'/g, '').trim();
    let icon_dir = path.join(__dirname, 'assets', 'icons');
    try {
        let search_path = [];
        search_path.push(path.join(home, '.local/share/icons'), path.join(home, '.icons'), '/usr/share/icons');
        search_path.every(icon_path => {
            if (fs.existsSync(path.join(icon_path, icon_theme))) {
                icon_dir = path.join(icon_path, icon_theme);

                return false;
            } else {
                icon_dir = path.join(__dirname, 'assets', 'icons');
                return true;
            }
        })
        let folder_icon_path = ''
        let icon_dirs = [path.join(icon_dir, 'emblems@2x/16/emblem-symbolic-link.svg'), path.join(icon_dir, '16x16/emblems/emblem-symbolic-link.svg'), path.join(icon_dir, 'emblems/scalable/emblem-symbolic-link.svg'), path.join(icon_dir, 'emblems/16/emblem-symbolic-link.svg')];
        icon_dirs.every(icon_dir => {
            if (fs.existsSync(icon_dir)) {
                folder_icon_path = icon_dir
                return false;
            } else {
                folder_icon_path = path.join(__dirname, 'assets/icons/emblem-symbolic-link.svg')
                return true;
            }
        })
        return folder_icon_path;
    } catch (err) {
        console.log(err);
    }
})

// Change theme
ipcMain.on('change_theme', (e, theme) => {
    nativeTheme.themeSource = theme.toLocaleLowerCase();
})

// Get Settings
ipcMain.on('saveRecentFile', (e, href) => {
    saveRecentFile(href);
})

ipcMain.on('update_settings', (e, keys = [], value) => {

    let path = ''
    if (keys.length == 1) {
        settings[keys[0]] = value;
    } else {
        settings[keys[0]][keys[1]] = value;
    }

    // fs.writeFileSync(settings_file, JSON.stringify(settings, null, 4));
    settingsManger.updateSettings(settings);
    win.send('msg', 'Settings updated')

})

ipcMain.on('update_settings_columns', (e, key, value, location) => {
    settings.Captions[key] = value;
    // fs.writeFileSync(settings_file, JSON.stringify(settings, null, 4));
    settingsManger.updateSettings(settings);
    win.send('msg', 'Settings updated')
    win.send('get_view', location)
})

ipcMain.on('create_thumbnail', (e, href) => {
    // Note: Attempting thumbnail creation at the get_files call
    let thumb_dir = path.join(app.getPath('userData'), 'thumbnails')
    thumb.postMessage({ cmd: 'create_thumbnail', href: href, thumb_dir: thumb_dir });
})

ipcMain.handle('get_thumbnails_directory', async (e) => {
    let thumbnails_dir = path.join(app.getPath('userData'), 'thumbnails')
    if (!fs.existsSync(thumbnails_dir)) {
        fs.mkdirSync(thumbnails_dir)
    }
    return thumbnails_dir;
})

ipcMain.handle('get_thumbnail', (e, file) => {
    let thumbnail_dir = path.join(app.getPath('userData'), 'thumbnails')
    let thumbnail = `${path.join(thumbnail_dir, `${file.mtime}_${path.basename(file.href)}`)}`
    if (!gio.exists(thumbnail)) {
        thumbnail = `./assets/icons/image-generic.svg`
    }
    return thumbnail;
})

// Populate global selected files array
ipcMain.on('get_selected_files', (e, selected_files) => {
    selected_files_arr = selected_files;
    // // console.log('selected files array', selected_files_arr);
})

function isValidUTF8(str) {
    try {
        new TextDecoder("utf-8").decode(new TextEncoder().encode(str));
        return true;
    } catch (error) {
        return false;
    }
}

ipcMain.on('search', (e, search, location, depth) => {
    find.postMessage({ cmd: 'search', search: search, location: location, depth: depth });
})

// Om Get Recent Files
ipcMain.on('get_recent_files', (e, dir) => {
    getRecentFiles(dirents => {
        win.send('recent_files', dirents)
    })
})

// On Get Folder Size
ipcMain.on('get_folder_size', (e, href) => {
    worker.postMessage({ cmd: 'folder_size', source: href });
})

// Currently using On Get Folder Size for properties!!
ipcMain.handle('get_folder_size_properties', async (e, href) => {
    try {
        let cdm = {
            cmd: 'get_folder_size',
            source: href
        }
        worker.postMessage(cdm);
    } catch (error) {
        console.error(error);
        return 0;
    }
})

// On Get Folder Count
ipcMain.on('get_folder_count', (e, href) => {
    worker.postMessage({ cmd: 'folder_count', source: href });
})

// On Get Folder Count
ipcMain.on('get_file_count', (e, href) => {
    try {
        getFileCount(href, file_count => {
            win.send('file_count', href, file_count);
        })
    } catch (err) {
        // console.log(err);
    }
})

// On Properties
ipcMain.on('get_properties', (e, selected_files_arr, location) => {
    let cmd = {
        cmd: 'properties',
        selected_files_arr: selected_files_arr
    }
    worker.postMessage(cmd);

    // let properties_arr = [];
    // if (selected_files_arr.length > 0) {
    //     selected_files_arr.forEach(item => {
    //         let properties = gio.get_file(item);
    //         // console.log(properties);
    //         properties_arr.push(properties);
    //     })
    // } else {
    //     let properties = gio.get_file(location);
    //     properties_arr.push(properties);
    // }
    // console.log('props', properties_arr);
    // win.send('properties', properties_arr);
})

// On get card gio
ipcMain.on('get_card_gio', (e, destination) => {
    win.send('get_card_gio', gio.get_file(destination));
})

ipcMain.handle('get_subfolders', (e, source) => {
    gio.ls(source, (err, dirents) => {
        return dirents;
    })
})

ipcMain.handle('settings', async (e) => {
    let settings = settingsManger.getSettings() //await JSON.parse(fs.readFileSync(settings_file, 'utf-8'));
    return settings;
})

ipcMain.on('count', (e, href) => {
    worker.postMessage({ cmd: 'count', source: href });
})

// New Window
ipcMain.on('new_window', (e) => {
    createWindow();
})

ipcMain.on('clip', (e, href) => {
    clipboard.write()
})

// ipcMain.on('ondragstart', (e, href) => {
//     const icon = path.join(__dirname, 'assets/icons/dd.png');
//     e.sender.startDrag({
//         file: href,
//         icon: icon
//     })
// })

// Get Devices
ipcMain.handle('get_devices', async (e) => {

    return new Promise((resolve, reject) => {
        try {
            let device_arr = gio.get_mounts();
            // console.log(device_arr)
            let filter_arr = device_arr.filter(x => x.name != 'mtp')
            resolve(filter_arr);
        } catch (err) {
            console.log(err);
        }
    });
})

// Add Workspace
ipcMain.on('add_workspace', (e, selected_files_arr) => {

    let workspace_file = path.join(app.getPath('userData'), 'workspace.json');
    let workspace_data = JSON.parse(fs.readFileSync(workspace_file, 'utf8'))

    selected_files_arr.forEach(item => {
        let file = gio.get_file(item);
        workspace_data.push(file)
    })
    fs.writeFileSync(workspace_file, JSON.stringify(workspace_data, null, 4));
    win.send('get_workspace');
    selected_files_arr = [];
})

// Remove Workspace
ipcMain.on('remove_workspace', (e, href) => {

    let workspace_file = path.join(app.getPath('userData'), 'workspace.json');
    let workspace_data = JSON.parse(fs.readFileSync(workspace_file, 'utf8'));

    let workspace = workspace_data.filter(data => data.href !== href);
    fs.writeFileSync(workspace_file, JSON.stringify(workspace, null, 4));

    win.send('get_workspace');

    selected_files_arr = [];
})

// Get Workspae
ipcMain.handle('get_workspace', async (e) => {

    let workspace_file = path.join(app.getPath('userData'), 'workspace.json');
    if (!gio.exists(workspace_file)) {
        let workspace_data = [];
        fs.writeFileSync(workspace_file, JSON.stringify(workspace_data, null, 4));
    }
    let workspace_items = JSON.parse(fs.readFileSync(workspace_file, 'utf-8'));
    return workspace_items;

})

// Update workspace
ipcMain.on('rename_workspace', (e, href, workspace_name) => {

    let workspace_file = path.join(app.getPath('userData'), 'workspace.json');
    let workspace_data = JSON.parse(fs.readFileSync(workspace_file, 'utf8'));

    let index = workspace_data.findIndex(data => data.href === href);
    if (index !== -1) {
        workspace_data[index].name = workspace_name;
        fs.writeFileSync(workspace_file, JSON.stringify(workspace_data, null, 4));
        win.send('get_workspace');
    } else {
        console.error("Workspace entry not found with href:", href);
    }

})

// Set isMain Flag
ipcMain.on('main', (e, flag) => {
    is_main = flag;
})

// New Folder
ipcMain.on('mkdir', (e, href) => {
    worker.postMessage({ cmd: 'mkdir', destination: href })
})

// Open File in Native Application
ipcMain.on('open', (e, href) => {
    shell.openPath(href);
    win.send('clear');
})

// Get File Icon
ipcMain.handle('get_icon', async (e, href) => {
    return await app.getFileIcon(href, { size: 32 }).then(icon => {
        return icon.toDataURL();
    }).catch((err) => {
        return err;
    })
})

ipcMain.on('paste', (e, destination) => {

    let copy_arr = [];
    let copy_overwrite_arr = []
    let overwrite = 0;
    let location = destination; //document.getElementById('location');

    // set active flag
    is_active = 1;

    if (selected_files_arr.length > 0) {

        for (let i = 0; i < selected_files_arr.length; i++) {

            let source = selected_files_arr[i];
            let destination = path.format({ dir: location, base: path.basename(selected_files_arr[i]) });
            let file = gio.get_file(source)

            // Directory
            if (file.type === 'directory') {
                if (source == destination) {
                    // destination = `${destination} (1)`;
                } else {
                    if (gio.exists(destination)) {
                        win.send('msg', 'Overwrite not yet implemented');
                        overwrite = 1;
                    }
                }

                // Files
            } else {
                if (source === destination) {
                    // this is not building the filename correctly when a file extension has .tar.gz
                    destination = path.dirname(destination) + '/' + path.basename(destination, path.extname(destination)) + ' (Copy)' + path.extname(destination);
                } else {
                    if (gio.exists(destination)) {
                        // win.send('msg', 'Overwrite not yet implemented');
                        overwrite = 1;
                    }
                }
            }

            let copy_data = {
                source: source, //selected_files_arr[i],
                destination: destination, //path.format({dir: location, base: path.basename(selected_files_arr[i])}),  //path.join(location, path.basename(selected_files_arr[i]))
                is_dir: file.is_dir
            }

            if (overwrite == 0) {
                copy_arr.push(copy_data);
            } else {
                copy_overwrite_arr.push(copy_data)
            }

            if (i == selected_files_arr.length - 1) {
                if (copy_arr.length > 0) {

                    let paste_worker = new Worker(path.join(__dirname, 'workers/worker.js'));
                    paste_worker.on('message', (data) => {
                        // console.log('paste cmd', data.cmd);
                        switch (data.cmd) {
                            case 'msg': {
                                win.send('msg', data.msg, data.has_timeout);
                                break;
                            }
                            case 'progress': {
                                win.send('set_progress', data)

                                if (data.max === 0) {
                                    win.send('msg', data.msg);
                                }
                                break;
                            }
                            case 'copy_done': {
                                if (is_main) {
                                    // if (watcher_failed) {
                                        let file = gio.get_file(data.destination);
                                        win.send('remove_card', data.destination);
                                        win.send('get_card_gio', file);
                                    // }
                                } else {
                                    if (!is_main) {
                                        win.send('get_folder_count', path.dirname(data.destination));
                                        win.send('get_folder_size', path.dirname(data.destination));
                                    }
                                }

                                win.send('lazyload');
                                win.send('clear');
                                break;
                            }

                        }
                    })

                    progress_id += 1;
                    let data = {
                        id: progress_id,
                        cmd: 'paste',
                        copy_arr: copy_arr
                    }
                    paste_worker.postMessage(data);

                }


                if (copy_overwrite_arr.length > 0) {
                    overWriteNext(copy_overwrite_arr);
                }

                copy_arr = [];
                copy_overwrite_arr = [];
                selected_files_arr = [];

            }
            // Reset variables
            overwrite = 0;
        }

    } else {
        //msg(`Nothing to Paste`);
    }

})

// Move
ipcMain.on('move', (e, destination) => {
    let copy_arr = [];
    if (selected_files_arr.length > 0) {
        for (let i = 0; i < selected_files_arr.length; i++) {
            let copy_data = {
                source: selected_files_arr[i],
                destination: path.format({ dir: destination, base: path.basename(selected_files_arr[i]) })
            }
            copy_arr.push(copy_data);
        }
        worker.postMessage({ cmd: 'mv', selected_items: copy_arr });
        selected_files_arr = [];
        copy_arr = [];
    } else {
        win.send('msg', `Nothing to Paste`);
    }
})

ipcMain.on('rename', (e, source, destination) => {
    worker.postMessage({ cmd: 'rename', source: source, destination: destination });
})

//////////////////////////////////////////////////////////////

// Create Main Window
function createWindow() {

    let displayToUse = 0;
    let lastActive = 0;
    let displays = screen.getAllDisplays();

    // Single Display
    if (displays.length === 1) {
        displayToUse = displays[0];
        // Multi Display
    } else {
        // if we have a last active window, use that display for the new window
        if (!displayToUse && lastActive) {
            displayToUse = screen.getDisplayMatching(lastActive.getBounds());
        }

        // fallback to primary display or first display
        if (!displayToUse) {
            displayToUse = screen.getPrimaryDisplay() || displays[3];
        }
    }

    if (window_settings.window.x == 0) {
        window_settings.window.x = displayToUse.bounds.x + 50
    }

    if (window_settings.window.y == 0) {
        window_settings.window.y = displayToUse.bounds.y + 50
    }

    // WINDOW OPTIONS
    let options = {
        minWidth: 400,
        minHeight: 400,
        width: window_settings.window.width,
        height: window_settings.window.height,
        backgroundColor: '#2e2c29',
        x: window_settings.window.x,
        y: window_settings.window.y,
        frame: true,
        autoHideMenuBar: true,
        icon: path.join(__dirname, '/assets/icons/sfm.png'),
        webPreferences: {
            nodeIntegration: false, // is default value after Electron v5
            contextIsolation: true, // protect against prototype pollution
            enableRemoteModule: false, // turn off remote
            nodeIntegrationInWorker: true,
            nativeWindowOpen: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
        },
    }

    win = new BrowserWindow(options);
    win.loadFile('index.html');

    settingsManger.showMenubar();

    win.once('ready-to-show', () => {
        win.show();
        // watch_for_theme_change();
        // win.webContents.once('dom-ready', () => {
        //     const selectables = win.webContents.executeJavaScript('document.querySelectorAll(".card")');
        //     const selectableContainer = win.webContents.executeJavaScript('document.getElementById("main")');
        //     dragSelect = new DragSelect({
        //         selectables: selectables,
        //         area: selectableContainer,
        //     });
        // });

    });

    win.on('close', (e) => {

        if (is_active) {
                const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                buttons: ['Cancel', 'Close Anyway'],
                title: 'Warning',
                message: 'An operation is still active. Are you sure you want to close?',
                defaultId: 1,
                cancelId: 0
            });

            if (choice === 0) {
            e.preventDefault(); // Prevent the window from closing
            }
        }
    })

    win.on('closed', () => {
        windows.delete(win);
    });

    win.on('resize', (e) => {
        setTimeout(() => {
            try {
                window_settings.window.width = win.getBounds().width;
                window_settings.window.height = win.getBounds().height;
                // fs.writeFileSync(path.join(__dirname, 'settings.json'), JSON.stringify(settings, null, 4));
                // fs.writeFileSync(settings_file, JSON.stringify(settings, null, 4));
                settingsManger.updateWindowSettings(window_settings);
            } catch (err) {

            }
        }, 1000);
    })

    win.on('move', (e) => {
        setTimeout(() => {
            try {
                window_settings.window.x = win.getBounds().x;
                window_settings.window.y = win.getBounds().y;
                // fs.writeFileSync(path.join(__dirname, 'settings.json'), JSON.stringify(settings, null, 4));
                // fs.writeFileSync(settings_file, JSON.stringify(window_settings, null, 4));
                settingsManger.updateWindowSettings(window_settings);
            } catch (err) {

            }
        }, 1000);
    })
    windows.add(win);

};

process.on('uncaughtException', (err) => {
    console.log('Uncaught Exception', err.message)
    // win.send('msg', error.message);
})

// Define the app events
app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.on('get_files', (e, source, tab) => {
    fileManager.get_files(source, tab)
    // worker.postMessage({cmd: 'preload', source: source});

    // let du = gio.du(source);
    // // console.log('disk usage', getFileSize(Math.abs(du)));
})

// Dialogs ////////////////////////////////////////////////////////////

function aboutDialog() {
    const packageInfo = require('./package.json');
    const aboutOptions = {
        title: `About ${packageInfo.name}`,
        message: `${packageInfo.name} ${packageInfo.version}`,
        detail: packageInfo.description,
        icon: path.join(__dirname, 'path/to/your/app-icon.png'),
        buttons: ['OK'],
        defaultId: 0,
    };

    dialog.showMessageBox(null, aboutOptions);
}

function open_with(file) {

    let bounds = win.getBounds()

    let x = bounds.x + parseInt((bounds.width - 400) / 2);
    let y = bounds.y + parseInt((bounds.height - 250) / 2);

    // Dialog Settings
    let confirm = new BrowserWindow({

        parent: window.getFocusedWindow(),
        modal: true,
        width: 400,
        height: 450,
        backgroundColor: '#2e2c29',
        x: x,
        y: y,
        frame: true,
        webPreferences: {
            nodeIntegration: true, // is default value after Electron v5
            contextIsolation: true, // protect against prototype pollution
            enableRemoteModule: false, // turn off remote
            nodeIntegrationInWorker: false,
            preload: path.join(__dirname, 'preload.js'),
        },

    })

    // Load file
    confirm.loadFile('dialogs/openwith.html')

    // Show dialog
    confirm.once('ready-to-show', () => {

        let title = 'Choose Application';
        confirm.title = title;
        confirm.removeMenu();

        // confirm.webContents.openDevTools();
        // get_desktop_apps();

        let exe_arr = get_apps();
        confirm.send('open_with', file, exe_arr);
        exe_arr = [];

    })

}

// Network connect dialog
function connectDialog() {

    let bounds = win.getBounds()

    let x = bounds.x + parseInt((bounds.width - 400) / 2);
    let y = bounds.y + parseInt((bounds.height - 350) / 2);


    connect_win = new BrowserWindow({
        parent: window.getFocusedWindow(),
        width: 400,
        height: 425,
        backgroundColor: '#2e2c29',
        x: x,
        y: y,
        frame: true,
        webPreferences: {
            // nodeIntegration: true, // is default value after Electron v5
            // contextIsolation: true, // protect against prototype pollution
            // enableRemoteModule: false, // turn off remote
            // nodeIntegrationInWorker: true,
            // preload: path.join(__dirname, 'preload.js'),
            preload: path.join(__dirname, './dialogs/connect.js'),
        },
    })

    connect_win.loadFile('dialogs/connect.html')
    // connect_win.webContents.openDevTools()

    // SHOW DIALG
    connect_win.once('ready-to-show', () => {
        let title = 'Connect to Server'
        connect_win.title = title
        connect_win.removeMenu()
        connect_win.send('connect')
    })

}

// Confirm Overwrite
function confirmOverwrite(source_file, destination_file, copy_overwrite_arr) {

    let bounds = win.getBounds()

    let x = bounds.x + parseInt((bounds.width - 500) / 2);
    let y = bounds.y + parseInt((bounds.height - 400) / 2);

    const confirm = new BrowserWindow({
        parent: win,
        modal: true,
        width: 550,
        height: 400,
        backgroundColor: '#2e2c29',
        x: x,
        y: y,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true, // is default value after Electron v5
            contextIsolation: true, // protect against prototype pollution
            enableRemoteModule: false, // turn off remote
            nodeIntegrationInWorker: false,
            preload: path.join(__dirname, 'dialogs/preload_diag.js'),
        },
    })

    confirm.loadFile('dialogs/confirm.html')
    // confirm.webContents.openDevTools();
    confirm.once('ready-to-show', () => {

        // if (fs.statSync(data.source).isDirectory()) {
        //     confirm.title = 'Copy Folder Conflict'
        // } else {
        //     confirm.title = 'Copy File Conflict'
        // }
        // confirm.removeMenu()
        confirm.show()
        confirm.send('confirming_overwrite', source_file, destination_file, copy_overwrite_arr);

    })
}

// Confirm Overwrite
function confirm(source_file, destination_file, copy_overwrite_arr) {

    let source = source_file.href;
    let destination = destination_file.href;

    win.send('merge_view', source, destination, copy_overwrite_arr);

}

// Handle Processing each OverWrite Dialog
function overWriteNext(copy_overwrite_arr, overwrite_all = 0) {

    copy_overwrite_arr.every((item, idx) => {

        let source_file = gio.get_file(item.source);
        let destination_file = gio.get_file(item.destination);

        if (overwrite_all) {
            return false;
        } else {
            confirm(source_file, destination_file, copy_overwrite_arr);
            return false;
        }

        // if (overwrite_all) {
        //     if (item.type === 'directory') {
        //         // confirm(gio.get_file(item.source), gio.get_file(item.destination), copy_overwrite_arr);
        //         if (!gio.exists(item.destination)) {
        //             worker.postMessage({cmd: 'mkdir', destination: item.destination});
        //         }
        //         return true;
        //     } else {
        //         if (gio.exists(item.destination)) {
        //             worker.postMessage({cmd: 'cp', source: item.source, destination: item.destination});
        //         } else {
        //             worker.postMessage({cmd: 'cp', source: item.source, destination: item.destination});
        //         }
        //         // console.log(copy_overwrite_arr.length);
        //         return true
        //     }
        // } else {
        //     if (item.type === 'directory') {

        //         let source_file = gio.get_file(item.source);
        //         let destination_file = gio.get_file(item.destination);

        //         if (gio.exists(item.destination)) {
        //             confirm(source_file, destination_file, copy_overwrite_arr);
        //         } else {
        //             worker.postMessage({cmd: 'mkdir', destination: item.destination});
        //         }
        //         return false;
        //     } else {
        //         if (gio.exists(item.destination)) {

        //             let source_file = gio.get_file(item.source);
        //             let destination_file = gio.get_file(item.destination);

        //             // console.log('source', item.source, 'destination', item.destination)

        //             if (source_file && destination_file) {
        //                 confirm(source_file, destination_file, copy_overwrite_arr);
        //             }
        //             return false;
        //         } else {
        //             gio.cp(item.sourcem, item,destination);
        //             // worker.postMessage({cmd: 'cp', source: item.source, destination: item.destination});
        //         }
        //         copy_overwrite_arr.splice(0, idx);
        //         // console.log(copy_overwrite_arr.length);
        //         return true
        //     }
        // }

    })

    // copy_overwrite_arr.every((item) => {
    //     gio_utils.get_file(item.source, source_file => {
    //         if (!gio.exists(item.destination)) {

    //             // console.log('destination does not exist');
    //             worker.postMessage({cmd: 'paste', copy_arr: copy_overwrite_arr, overwrite_flag: 0});
    //             return false

    //         } else {
    //             gio_utils.get_file(item.destination, destination_file => {

    //                 if (overwrite_all) {

    //                     copy_overwrite_arr.every((item, idx) => {

    //                         if (item.type === 'directory') {

    //                             confirm(source_file, destination_file, copy_overwrite_arr);
    //                             return false;
    //                             // gio_utils.get_file(item.source, source_file1 => {
    //                             //     gio_utils.get_file(item.destination, destination_file1 => {
    //                             //         confirm(source_file1, destination_file1, copy_overwrite_arr);
    //                             //         // copy_overwrite_arr.splice(0, idx);
    //                             //         return false;
    //                             //     })
    //                             // })
    //                         } else {
    //                             if (gio.exists(destination_file.href)) {
    //                                 worker.postMessage({cmd: 'cp', source: item.source, destination: item.destination, overwrite_flag: 1});
    //                             } else {
    //                                 worker.postMessage({cmd: 'cp', source: item.source, destination: item.destination, overwrite_flag: 0});
    //                             }
    //                             copy_overwrite_arr.splice(0, idx);
    //                             return true;
    //                         }
    //                     })
    //                 } else {
    //                     // Show Overwrite Dialog
    //                     confirm(source_file, destination_file, copy_overwrite_arr);
    //                     return false;
    //                 }

    //             })
    //         }
    //     })

    // })
}

// Call Confirm Overwrite function
ipcMain.on('confirm_overwrite', (e, copy_overwrite_arr) => {
    copy_overwrite_arr.forEach(item => {
        get_files_arr(item.source, item.destination, files_arr => {
            overWriteNext(files_arr);
            // for (let i = 0; i < files_arr.length; i++) {
            //     if (file.type === 'file') {
            //         overWriteNext()
            //         // gio_utils.get_file(files_arr[i].source, source => {
            //         //     gio_utils.get_file(files_arr[i].destination, destination => {
            //         //     })
            //         // })
            //     }
            // }
        })
    })
    // overWriteNext(copy_overwrite_arr);
})

// Overwrite Confirmed
ipcMain.on('overwrite_confirmed', (e, source, destination, copy_overwrite_arr) => {

    let confirm = BrowserWindow.getFocusedWindow();
    confirm.hide()

    let copy_arr = copy_overwrite_arr.filter(x => x.source == source);
    copy_arr[0].overwrite_flag = 1;

    // console.log(`Overwrite Confirmed ${source} with ${destination}`);
    worker.postMessage({ cmd: 'paste', copy_arr: copy_arr });

    copy_overwrite_arr.splice(0, 1);
    overWriteNext(copy_overwrite_arr);

})

// Overwrite Cancelled
ipcMain.on('overwrite_canceled_all', (e) => {

    let confirm = BrowserWindow.getFocusedWindow();
    confirm.hide()

})

// Overwrite Cancelled
ipcMain.on('overwrite_canceled', (e) => {

    let confirm = BrowserWindow.getFocusedWindow();
    confirm.hide()

})

// Create Delete Dialog
ipcMain.on('delete', (e, selecte_files_arr) => {
    let bounds = win.getBounds()

    let x = bounds.x + parseInt((bounds.width - 400) / 2);
    let y = bounds.y + parseInt((bounds.height - 250) / 2);

    // Dialog Settings
    let confirm = new BrowserWindow({

        parent: window.getFocusedWindow(),
        modal: true,
        width: 500,
        height: 300,
        backgroundColor: '#2e2c29',
        x: x,
        y: y,
        frame: true,
        webPreferences: {
            // nodeIntegration: true, // is default value after Electron v5
            // contextIsolation: true, // protect against prototype pollution
            // enableRemoteModule: false, // turn off remote
            // nodeIntegrationInWorker: false,
            preload: path.join(__dirname, 'preload.js'),
        },

    })

    confirm.setMinimumSize(400, 250);

    // Load file
    confirm.loadFile('dialogs/confirmdelete.html')

    // Show dialog
    confirm.once('ready-to-show', () => {

        let title = 'Confirm Delete';
        confirm.title = title;
        confirm.id = confirm;
        confirm.removeMenu();
        // confirm.webContents.openDevTools();

        confirm.send('confirm_delete', selecte_files_arr);
        selecte_files_arr = [];

    })

})

// Delete Confirmed
ipcMain.on('delete_confirmed', (e, selected_files_arr) => {

    // Send array to worker
    let worker = new Worker(path.join(__dirname, 'workers/worker.js'));
    worker.on('message', (data) => {

        console.log('del_conf cmd', data.cmd);

        switch (data.cmd) {

            case 'msg': {
                win.send('msg', data.msg, data.has_timeout);
                break;
            }
            case 'progress': {
                win.send('set_progress', data)
                // If data.max = 0 then we are done
                if (data.max === 0) {
                    win.send('msg', data.msg);
                }
                break;
            }

            // this fires after each file or directory is deleted
            case 'delete_done': {
                win.send('remove_card', data.source);
                break;
            }
        }

    })

    let delete_confirmed = {
        id: progress_id += 1,
        cmd: 'delete_confirmed',
        files_arr: selected_files_arr
    }
    worker.postMessage(delete_confirmed);

    let confirm = BrowserWindow.getFocusedWindow();
    confirm.hide();

})

// Delete Canceled
ipcMain.on('delete_canceled', (e) => {
    let confirm = BrowserWindow.getFocusedWindow()
    confirm.hide()
})

ipcMain.on('cancel_get_files', (e) => {
    let cmd = {
        cmd: 'cancel_get_files'
    }
    worker.postMessage(cmd);
})

// Menus////////////////////////////////////////////////////////////////

// Set Defaul Launcher
function set_default_launcher(desktop_file, mimetype) {
    let cmd = 'xdg-mime default ' + desktop_file + ' ' + mimetype
    try {
        execSync(cmd)
    } catch (err) {
        notification(err)
    }

}

// Lanucher Menu
let launcher_menu
function add_launcher_menu(menu, e, file) {

    // Populate Open With Menu
    let launchers = gio.open_with(file.href);
    launchers.sort((a, b) => {
        return a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase());
    })

    launcher_menu = menu.getMenuItemById('launchers')
    try {
        for (let i = 0; i < launchers.length; i++) {
            launcher_menu.submenu.append(new MenuItem({
                label: launchers[i].name,
                click: () => {

                    // console.log(launchers[i]);

                    // Set Default Application
                    let set_default_launcher_cmd = `xdg-mime default ${path.basename(launchers[i].appid)} ${launchers[i].mimetype}`;
                    // console.log(set_default_launcher_cmd)
                    execSync(set_default_launcher_cmd);

                    let cmd = launchers[i].cmd.toLocaleLowerCase().replace(/%u|%f/g, `'${file.href}'`);
                    exec(cmd);

                    // shell.openPath(file.href);
                    win.send('clear');

                }
            }))
        }
        launcher_menu.submenu.append(new MenuItem({
            type: 'separator'
        }))

    } catch (err) {
        // console.log(err)
    }
}

function createFileFromTemplate(source, destination) {
    worker.postMessage({ cmd: 'cp_template', source: source, destination: destination });
}

// Templated Menu
function add_templates_menu(menu, location) {
    let template_menu = menu.getMenuItemById('templates')
    let templates = fs.readdirSync(path.join(home, 'Templates'))
    templates.forEach((file, idx) => {
        let source = path.join(home, 'Templates', file);
        let destination = path.format({ dir: location, base: file });
        template_menu.submenu.append(new MenuItem({
            label: file.replace(path.extname(file), ''),
            click: () => {
                createFileFromTemplate(source, destination);
            }
        }));
    })
}

// Extract Menu
function extract_menu(menu, e) {

    let menu_item = new MenuItem(
        {
            label: '&Extract',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Extract : settings.keyboard_shortcuts.Extract,
            click: () => {
                e.sender.send('context-menu-command', 'extract')
            }
        }
    )
    menu.insert(15, menu_item)
}

// Convert audio Menu
function add_convert_audio_menu(menu, href) {

    menu.append(new MenuItem({
        label: 'Audio / Video',
        submenu: [
            {
                label: 'Convert to Mp3',
                click: () => {
                    let filename = href.substring(0, href.length - path.extname(href).length) + '.mp3'
                    let cmd = 'ffmpeg -i ' + href + ' ' + filename;
                    exec(cmd, (err, stdout, stderr) => {
                        if (err) {
                            win.send('notification', err);
                        } else {
                            let options = {
                                id: 0,
                                href: filename,
                                linktext: path.basename(filename),
                                is_folder: false,
                                grid: ''
                            }
                            win.send('add_card', options)
                        }
                    })

                    cmd = 'ffprobe -i ' + href + ' -show_entries format=size -v quiet -of csv="p=0"'
                    exec(cmd, (err, stdout, stderr) => {
                        if (err) {
                            win.send('notification', err)
                        } else {
                            win.send('progress', parseInt(stdout))
                        }
                    })

                },
            },
            {
                label: 'Convert to Ogg Vorbis',
                click: () => {
                    let filename = href.substring(0, href.length - path.extname(href).length) + '.ogg'
                    let cmd = 'ffmpeg -i ' + href + ' -c:a libvorbis -q:a 4 ' + filename;

                    exec(cmd, (err, stdout, stderr) => {
                        if (err) {
                            win.send('notification', err);
                        } else {
                            let options = {
                                id: 0,
                                href: filename,
                                linktext: path.basename(filename),
                                is_folder: false,
                                grid: ''
                            }
                            win.send('add_card', options)
                        }
                    })

                    cmd = 'ffprobe -i ' + href + ' -show_entries format=size -v quiet -of csv="p=0"'
                    exec(cmd, (err, stdout, stderr) => {
                        if (err) {
                            win.send('notification', err)
                        } else {
                            win.send('progress', parseInt(stdout))
                        }
                    })
                }
            },
        ]

    }))

}

let sort = 'date_desc';
ipcMain.on('sort', (e, sort_by) => {
    sort = sort_by
})
function sort_menu() {

    let submenu = [
        {
            label: 'Last Modified',
            type: 'radio',
            id: 'date_desc',
            click: () => {
                sort = 'modified_desc';
                win.send('sort_cards', sort);
            }
        },
        {
            label: 'First Modified',
            type: 'radio',
            id: 'modified_asc',
            click: () => {
                sort = 'modified_asc';
                win.send('sort_cards', sort);
            }
        },
        {
            label: 'A-Z',
            type: 'radio',
            id: 'name_asc',
            click: () => {
                sort = 'name_asc';
                win.send('sort_cards', sort)
            }
        },
        {
            label: 'Z-A',
            type: 'radio',
            id: 'name_desc',
            click: () => {
                sort = 'name_desc';
                win.send('sort_cards', sort)
            }
        },
        {
            label: 'Size',
            type: 'radio',
            id: 'size',
            click: () => {
                sort = 'size';
                win.send('sort_cards', sort)
            }
        },
        {
            label: 'Type',
            type: 'radio',
            id: 'type',
            click: () => {
                sort = 'type';
                win.send('sort_cards', sort)
            }
        }
    ]

    return submenu;

}

// Main Menu
let main_menu = null;
ipcMain.on('main_menu', (e, destination) => {

    // console.log('dest', destination)

    is_main = 1;

    const template = [
        {
            label: 'New Window',
            click: () => {
                createWindow(destination);
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'New Folder',
            icon: path.join(__dirname, 'assets/icons/menu/folder.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.NewFolder : settings.keyboard_shortcuts.NewFolder,
            click: () => {
                new_folder(path.format({ dir: destination, base: 'New Folder' }));
            }
        },
        {
            id: 'templates',
            label: 'New Document',
            submenu: [
                {
                    label: 'Open Templates Folder',
                    click: () => {
                        e.sender.send('context-menu-command', 'open_templates'),
                        {
                            type: 'separator'
                        }
                    }
                }],
        },
        {
            type: 'separator'
        },
        {
            label: 'Sort',
            id: 'sort_menu',
            submenu: sort_menu()
        },
        {
            type: 'separator'
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Grid',
                    icon: path.join(__dirname, 'assets/icons/menu/grid.png'),
                    // accelerator: process.platform === 'darwin' ? 'Shift+G' : 'Shift+G',
                    click: (e) => {
                        win.send('switch_view', 'grid')
                        // win.webContents.reloadIgnoringCache();
                    }
                },
                {
                    label: 'List',
                    icon: path.join(__dirname, 'assets/icons/menu/list.png'),
                    // accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+L' : 'CmdOrCtrl+L',
                    click: () => {
                        win.send('switch_view', 'list')
                        // win.webContents.reloadIgnoringCache();
                    }
                },
            ]
        },
        {
            type: 'separator'
        },
        {
            label: 'Paste',
            icon: path.join(__dirname, 'assets/icons/menu/paste.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Paste : settings.keyboard_shortcuts.Paste,
            click: () => {
                e.sender.send('context-menu-command', 'paste')
            }
        },
        {
            label: 'Select all',
            click: () => {
                e.sender.send('select_all');
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Terminal',
            click: () => {
                e.sender.send('context-menu-command', 'terminal')
            }
        },
        {
            type: 'separator'
        },
        {
            type: 'separator'
        },
        {
            label: 'Show Hidden',
            // icon: path.join(__dirname, 'assets/icons/menu/eye.png'),
            checked: false,
            click: (e) => {
                // e.sender.send('context-menu-command', 'show_hidden')
                win.send('toggle_hidden');
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Disk Usage Analyzer',
            icon: path.join(__dirname, 'assets/icons/menu/diskusage.png'),
            click: () => {
                exec(`baobab ${destination}`);
            }

        }
    ]

    // Create menu
    main_menu = Menu.buildFromTemplate(template)

    let sort_menu_item = main_menu.getMenuItemById('sort_menu');
    let sort_submenu_items = sort_menu_item.submenu.items
    for (const item of sort_submenu_items) {
        if (item.id == sort) {
            item.checked = true;
        }
    }

    // Add templates
    add_templates_menu(main_menu, destination)

    // Show menu
    main_menu.popup(BrowserWindow.fromWebContents(e.sender))

})

// Folders Menu
ipcMain.on('folder_menu', (e, file) => {

    // console.log('file', file)

    const template = [
        {
            label: 'Open with Code',
            type: 'checkbox',
            click: () => {
                exec(`cd "${file.href}"; code .`, (err) => {
                    win.send('clear');
                    if (err) {
                        return;
                    }
                })
                // e.sender.send('context-menu-command', 'vscode')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'New Window',
            click: () => {
                createWindow(file.href);
            }
        },
        {
            label: 'New Tab',
            click: () => {
                ls.postMessage({ cmd: 'ls', source: file.href, tab: 1 });
            }
        },
        {
            id: 'launchers',
            label: 'Open with',
            submenu: []
        },
        {
            type: 'separator'
        },
        {
            type: 'separator'
        },
        {
            id: 'sort_menu',
            label: 'Sort',
            submenu: sort_menu()
        },
        {
            type: 'separator'
        },
        // {
        //     label: 'New Folder',
        //     icon: path.join(__dirname, 'assets/icons/menu/folder.png'),
        //     accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.NewFolder : settings.keyboard_shortcuts.NewFolder,
        //     click: () => {
        //         new_folder(path.format({ dir: destination, base: 'New Folder' }));
        //     }
        // },
        // {
        //     id: 'templates',
        //     label: 'New Document',
        //     submenu: [
        //         {
        //             label: 'Open Templates Folder',
        //             click: () => {
        //                 e.sender.send('context-menu-command', 'open_templates'
        //                 ),
        //                 {
        //                     type: 'separator'
        //                 }
        //             }
        //         },],
        // },
        {
            type: 'separator'
        },
        {
            label: 'Add to workspace',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.AddWorkspace : settings.keyboard_shortcuts.AddWorkspace,
            click: () => {
                e.sender.send('context-menu-command', 'add_workspace');
            },
        },
        {
            type: 'separator'
        },
        {
            label: 'Cut',
            // icon: path.join(__dirname, 'assets/icons/menu/cut.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Cut : settings.keyboard_shortcuts.Cut,
            click: () => {
                e.sender.send('context-menu-command', 'cut')
            }
        },
        {
            label: 'Copy',
            icon: path.join(__dirname, 'assets/icons/menu/copy.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Copy : settings.keyboard_shortcuts.Copy,
            click: () => {
                e.sender.send('context-menu-command', 'copy')
            }
        },
        {
            label: '&Rename',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Rename : settings.keyboard_shortcuts.Rename,
            click: () => {
                e.sender.send('context-menu-command', 'rename')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Compress',
            icon: path.join(__dirname, 'assets/icons/menu/extract.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Compress : settings.keyboard_shortcuts.Compress,
            submenu: [
                {
                    label: 'tar.gz',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress')
                    }
                },
                {
                    label: 'zip',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress_zip')
                    }
                },
            ]
        },
        {
            type: 'separator'
        },
        {
            label: 'Delete Permanently',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Delete : settings.keyboard_shortcuts.Delete,
            click: () => {
                // e.sender.send('context-menu-command', 'delete_folder')
                e.sender.send('context-menu-command', 'delete')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Open in terminal',
            click: () => {
                e.sender.send('context-menu-command', 'terminal');
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Disk Usage Analyzer',
            icon: path.join(__dirname, 'assets/icons/menu/diskusage.png'),
            click: () => {
                exec(`baobab ${file.href}`);
            }

        },
        {
            type: 'separator'
        },
        {
            label: 'Properties',
            icon: path.join(__dirname, 'assets/icons/menu/properties.png'),
            accelerator: process.platform == 'darwin' ? settings.keyboard_shortcuts.Properties : settings.keyboard_shortcuts.Properties,
            click: () => {
                e.sender.send('context-menu-command', 'properties')
            }
        },

    ]

    const menu = Menu.buildFromTemplate(template);

    // Handle Sort Menu
    let sort_menu_item = menu.getMenuItemById('sort_menu');
    let sort_submenu_items = sort_menu_item.submenu.items
    for (const item of sort_submenu_items) {
        if (item.id == sort) {
            item.checked = true;
        }
    }

    // ADD LAUNCHER MENU
    add_launcher_menu(menu, e, file)

    // ADD TEMPLATES
    // add_templates_menu(menu, file.);

    // ADD LAUNCHER MENU
    //   add_launcher_menu(menu1, e, args);
    menu.popup(BrowserWindow.fromWebContents(e.sender));

})

// Files Menu
ipcMain.on('file_menu', (e, file) => {

    // const template = [
    let files_menu_template = [
        {
            id: 'launchers',
            label: 'Open with',
            submenu: []
        },
        {
            type: 'separator'
        },
        {
            label: 'Add to workspace',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.AddWorkspace : settings.keyboard_shortcuts.AddWorkspace,
            click: () => {
                e.sender.send('context-menu-command', 'add_workspace')
            }
        },
        {
            type: 'separator'
        },
        {
            id: 'sort_menu',
            label: 'Sort',
            submenu: sort_menu()
        },
        {
            type: 'separator'
        },
        {
            label: 'Cut',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Cut : settings.keyboard_shortcuts.Cut,
            click: () => {
                e.sender.send('context-menu-command', 'cut')
            }
        },
        {
            label: 'Copy',
            icon: path.join(__dirname, 'assets/icons/menu/copy.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Copy : settings.keyboard_shortcuts.Copy,
            click: () => {
                e.sender.send('context-menu-command', 'copy')
            }
        },
        {
            label: '&Rename',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Rename : settings.keyboard_shortcuts.Rename,
            click: () => { e.sender.send('context-menu-command', 'rename') }
        },
        {
            type: 'separator'
        },
        // {
        //     id: 'templates',
        //     label: 'New Document',
        //     submenu: [
        //         {
        //             label: 'Open Templates Folder',
        //             click: () => {
        //                 e.sender.send('context-menu-command', 'open_templates_folder'
        //                 ),
        //                 {
        //                     type: 'separator'
        //                 }
        //             }
        //         }],
        // },
        // {
        //     label: '&New Folder',
        //     icon: path.join(__dirname, 'assets/icons/menu/folder.png'),
        //     accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.NewFolder : settings.keyboard_shortcuts.NewFolder,
        //     click: () => {
        //         e.sender.send('context-menu-command', 'new_folder')
        //     }
        // },
        {
            type: 'separator'
        },
        {
            label: 'Compress',
            icon: path.join(__dirname, 'assets/icons/menu/extract.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Compress : settings.keyboard_shortcuts.Compress,
            submenu: [
                {
                    label: 'tar.gz',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress')
                    }
                },
                {
                    label: 'zip',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress_zip')
                    }
                },
            ]
        },
        {
            type: 'separator'
        },
        {
            label: 'Delete Permanently',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Delete : settings.keyboard_shortcuts.Delete,
            click: () => {
                // e.sender.send('context-menu-command', 'delete_file')
                e.sender.send('context-menu-command', 'delete')
            }
        },
        {
            type: 'separator'
        },
        // {
        //     label: 'Terminal',
        //     click: () => {
        //         e.sender.send(
        //             'context-menu-command', 'open_terminal'
        //         )
        //     }
        // },
        {
            type: 'separator'
        },
        {
            label: 'Properties',
            icon: path.join(__dirname, 'assets/icons/menu/properties.png'),
            accelerator: process.platform == 'darwin' ? settings.keyboard_shortcuts.Properties : settings.keyboard_shortcuts.Properties,
            click: () => {
                e.sender.send('context-menu-command', 'properties')
            }
        },
    ]

    let menu = Menu.buildFromTemplate(files_menu_template)

    // Handle Sort Menu
    let sort_menu_item = menu.getMenuItemById('sort_menu');
    let sort_submenu_items = sort_menu_item.submenu.items
    for (const item of sort_submenu_items) {
        if (item.id == sort) {
            item.checked = true;
        }
    }

    // ADD TEMPLATES
    // add_templates_menu(menu, e, args)

    // ADD LAUNCHER MENU
    add_launcher_menu(menu, e, file)

    // Run as program
    // if (args.access) {
    // add_execute_menu(menu, e, args)
    // }

    // Handle Audio conversion
    let ext = path.extname(file.href);
    if (ext == '.mp4' || ext == '.mp3') {
        add_convert_audio_menu(menu, file.href);
    }

    if (ext == '.xz' || ext == '.gz' || ext == '.zip' || ext == '.img' || ext == '.tar') {
        extract_menu(menu, e);
    }

    menu.popup(BrowserWindow.fromWebContents(e.sender))

})

// Merge Folders Menu
ipcMain.on('merge_folder_menu', (e, href) => {

    let file = gio.get_file(href);
    // console.log(file)

    const template = [
        {
            label: 'Open with Code',
            click: () => {
                exec(`cd "${file.href}"; code .`, (err) => {
                    win.send('clear');
                    if (err) {
                        return;
                    }
                })
                // e.sender.send('context-menu-command', 'vscode')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'New Window',
            click: () => {
                createWindow(file.href);
            }
        },
        {
            label: 'New Tab',
            click: () => {
                ls.postMessage({ cmd: 'ls', source: file.href, tab: 1 });
            }
        },
        {
            id: 'launchers',
            label: 'Open with',
            submenu: []
        },
        {
            type: 'separator'
        },
        {
            type: 'separator'
        },
        {
            id: 'sort_menu',
            label: 'Sort',
            submenu: sort_menu()
        },
        {
            type: 'separator'
        },
        {
            label: 'New Folder',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.NewFolder : settings.keyboard_shortcuts.NewFolder,
            click: () => {
                e.sender.send('context-menu-command', 'new_folder')
            }
        },
        // {
        //     id: 'templates',
        //     label: 'New Document',
        //     submenu: [
        //         {
        //             label: 'Open Templates Folder',
        //             click: () => {
        //                 e.sender.send('context-menu-command', 'open_templates'
        //                 ),
        //                 {
        //                     type: 'separator'
        //                 }
        //             }
        //         },],
        // },
        {
            type: 'separator'
        },
        {
            label: 'Add to workspace',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.AddWorkspace : settings.keyboard_shortcuts.AddWorkspace,
            click: () => {
                e.sender.send('context-menu-command', 'add_workspace');
            },
        },
        {
            type: 'separator'
        },
        {
            label: 'Cut',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Cut : settings.keyboard_shortcuts.Cut,
            click: () => {
                e.sender.send('context-menu-command', 'cut')
            }
        },
        {
            label: 'Copy',
            icon: path.join(__dirname, 'assets/icons/menu/copy.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Copy : settings.keyboard_shortcuts.Copy,
            click: () => {
                e.sender.send('context-menu-command', 'copy')
            }
        },
        {
            label: '&Rename',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Rename : settings.keyboard_shortcuts.Rename,
            click: () => {
                e.sender.send('context-menu-command', 'rename')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Compress',
            icon: path.join(__dirname, 'assets/icons/menu/extract.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Compress : settings.keyboard_shortcuts.Compress,
            submenu: [
                {
                    label: 'tar.gz',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress')
                    }
                },
                {
                    label: 'zip',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress_zip')
                    }
                },
            ]
        },
        {
            type: 'separator'
        },
        {
            label: 'Delete Permanently',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Delete : settings.keyboard_shortcuts.Delete,
            click: () => {
                // e.sender.send('context-menu-command', 'delete_folder')
                e.sender.send('context-menu-command', 'delete')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Open in terminal',
            click: () => {
                e.sender.send('context-menu-command', 'terminal');
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Disk Usage Analyzer',
            icon: path.join(__dirname, 'assets/icons/menu/diskusage.png'),
            click: () => {
                exec(`baobab ${file.href}`);
            }

        },
        {
            type: 'separator'
        },
        {
            label: 'Properties',
            icon: path.join(__dirname, 'assets/icons/menu/properties.png'),
            accelerator: process.platform == 'darwin' ? settings.keyboard_shortcuts.Properties : settings.keyboard_shortcuts.Properties,
            click: () => {
                e.sender.send('context-menu-command', 'properties')
            }
        },

    ]

    const merge_folder_menu = Menu.buildFromTemplate(template);

    // Handle Sort Menu
    // let sort_menu_item = menu.getMenuItemById('sort_menu');
    // let sort_submenu_items = sort_menu_item.submenu.items
    // for (const item of sort_submenu_items) {
    //     if (item.id == sort) {
    //         item.checked = true;
    //     }
    // }

    // ADD LAUNCHER MENU
    // add_launcher_menu(menu, e, file)

    // ADD TEMPLATES
    // add_templates_menu(menu, file.);

    // ADD LAUNCHER MENU
    //   add_launcher_menu(menu1, e, args);
    merge_folder_menu.popup(BrowserWindow.fromWebContents(e.sender));

})

// Merge Files Menu
ipcMain.on('merge_file_menu', (e, href) => {

    let file = gio.get_file(href);

    // const template = [
    let files_menu_template = [
        {
            id: 'launchers',
            label: 'Open with',
            submenu: []
        },
        {
            type: 'separator'
        },
        {
            label: 'Add to workspace',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.AddWorkspace : settings.keyboard_shortcuts.AddWorkspace,
            click: () => {
                e.sender.send('context-menu-command', 'add_workspace')
            }
        },
        {
            type: 'separator'
        },
        {
            id: 'sort_menu',
            label: 'Sort',
            submenu: sort_menu()
        },
        {
            type: 'separator'
        },
        {
            label: 'Cut',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Cut : settings.keyboard_shortcuts.Cut,
            click: () => {
                e.sender.send('context-menu-command', 'cut')
            }
        },
        {
            label: 'Copy',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Copy : settings.keyboard_shortcuts.Copy,
            click: () => {
                e.sender.send('context-menu-command', 'copy')
            }
        },
        {
            label: '&Rename',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Rename : settings.keyboard_shortcuts.Rename,
            click: () => { e.sender.send('context-menu-command', 'rename') }
        },
        {
            type: 'separator'
        },
        // {
        //     id: 'templates',
        //     label: 'New Document',
        //     submenu: [
        //         {
        //             label: 'Open Templates Folder',
        //             click: () => {
        //                 e.sender.send('context-menu-command', 'open_templates_folder'
        //                 ),
        //                 {
        //                     type: 'separator'
        //                 }
        //             }
        //         }],
        // },
        {
            label: '&New Folder',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.NewFolder : settings.keyboard_shortcuts.NewFolder,
            click: () => {
                e.sender.send('context-menu-command', 'new_folder')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Compress',
            icon: path.join(__dirname, 'assets/icons/menu/extract.png'),
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Compress : settings.keyboard_shortcuts.Compress,
            submenu: [
                {
                    label: 'tar.gz',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress')
                    }
                },
                {
                    label: 'zip',
                    click: () => {
                        e.sender.send('context-menu-command', 'compress_zip')
                    }
                },
            ]
        },
        {
            type: 'separator'
        },
        {
            label: 'Delete Permanently',
            accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.Delete : settings.keyboard_shortcuts.Delete,
            click: () => {
                // e.sender.send('context-menu-command', 'delete_file')
                e.sender.send('context-menu-command', 'delete')
            }
        },
        {
            type: 'separator'
        },
        // {
        //     label: 'Terminal',
        //     click: () => {
        //         e.sender.send(
        //             'context-menu-command', 'open_terminal'
        //         )
        //     }
        // },
        {
            type: 'separator'
        },
        {
            label: 'Properties',
            icon: path.join(__dirname, 'assets/icons/menu/properties.png'),icon: path.join(__dirname, 'assets/icons/menu/properties.png'),
            accelerator: process.platform == 'darwin' ? settings.keyboard_shortcuts.Properties : settings.keyboard_shortcuts.Properties,
            click: () => {
                e.sender.send('context-menu-command', 'properties')
            }
        },
    ]

    let menu = Menu.buildFromTemplate(files_menu_template)

    // Handle Sort Menu
    let sort_menu_item = menu.getMenuItemById('sort_menu');
    let sort_submenu_items = sort_menu_item.submenu.items
    for (const item of sort_submenu_items) {
        if (item.id == sort) {
            item.checked = true;
        }
    }

    // ADD TEMPLATES
    // add_templates_menu(menu, e, args)

    // ADD LAUNCHER MENU
    add_launcher_menu(menu, e, file)

    // Run as program
    // if (args.access) {
    // add_execute_menu(menu, e, args)
    // }

    // Handle Audio conversion
    let ext = path.extname(file.href);
    if (ext == '.mp4' || ext == '.mp3') {
        add_convert_audio_menu(menu, file.href);
    }

    if (ext == '.xz' || ext == '.gz' || ext == '.zip' || ext == '.img' || ext == '.tar') {
        extract_menu(menu, e);
    }

    menu.popup(BrowserWindow.fromWebContents(e.sender))

})

// Devices Menu
ipcMain.on('device_menu', (e, href, uuid) => {

    // console.log(uuid)

    let device_menu_template = [
        {
            label: 'Connect',
            click: () => {
                connectDialog()
            }
        },
        {
            label: 'Unmount',
            click: () => {
                execSync(`gio mount -u ${href}`);
                win.send('msg', `Device Unmounted`);
                win.send('umount_device');
            }
        },
        {
            type: 'separator',
        },
        {
            label: 'Disks',
            click: () => {
                let cmd = settings['Disk Utility']
                exec(cmd, (err) => {
                    console.log(err)
                });
            }
        }
        // {
        //     label: 'Properties',
        //     accelerator: process.platform == 'darwin' ? settings.keyboard_shortcuts.Properties : settings.keyboard_shortcuts.Properties,
        //     click: () => {
        //         e.sender.send('context-menu-command', 'properties')
        //     }
        // },
    ]

    let menu = Menu.buildFromTemplate(device_menu_template)
    menu.popup(BrowserWindow.fromWebContents(e.sender))

})

// Workspace Menu
ipcMain.on('workspace_menu', (e, file) => {

    // // console.log(file)
    let workspace_menu_template = [
        {
            label: 'Rename',
            click: () => {
                win.send('edit_workspace', file.href);
            }
        },
        {
            type: 'separator',
        },
        {
            label: 'Remove From Workspace',
            click: () => {
                win.send('remove_workspace', file.href);
            }
        },
        {
            label: 'Open Location',
            click: () => {
                win.send('get_view', path.dirname(file.href))
            }
        }
    ]

    let menu = Menu.buildFromTemplate(workspace_menu_template)

    // ADD TEMPLATES
    // add_templates_menu(menu, e, args)

    // ADD LAUNCHER MENU
    // add_launcher_menu(menu, e, args.apps)
    menu.popup(BrowserWindow.fromWebContents(e.sender))

    menu.on('menu-will-close', () => {
        win.send('clear_items');
    });

})

ipcMain.on('sidebar_menu', (e, href) => {

    console.log(href);

    let menu_template = [
        {
            label: 'Open',
            click: () => {
                win.send('get_view', href)
            }
        },
        {
            label: 'Open In New Tab',
            click: () => {
                ls.postMessage({ cmd: 'ls', source: href, tab: 1 });
            }
        },
        // {
        //     label: 'Open In New Window',
        //     click: () => {
        //         createWindow();
        //     }
        // },
        {
            type: 'separator',
        },
        {
            label: 'Properties',
            icon: path.join(__dirname, 'assets/icons/menu/properties.png'),
            click: () => {
                get_properties(href);
                // e.sender.send('context-menu-command', 'sidebar_properties');
            }
        }
    ]
    let menu = Menu.buildFromTemplate(menu_template)
    menu.popup(BrowserWindow.fromWebContents(e.sender))

})

ipcMain.on('recent_menu', (e, file) => {

})

// Header Menu
const template = [
    {
        label: 'File',
        submenu: [
            {
                label: 'New Window',
                click: () => {
                    // win.send('context-menu-command', 'open_in_new_window')
                    createWindow();
                }
            },
            { type: 'separator' },
            // {
            //     label: 'Create New Folder',
            //     click: () => {

            //     }
            // },
            {
                label: 'Preferences',
                submenu: [
                    {
                        label: 'Settings',
                        click: () => {
                            win.send('get_settings');
                        }
                    }
                ]
            },
            { type: 'separator' },
            {
                label: 'Connect to Server',
                click: () => {
                    connectDialog();
                }
            },
            {
                label: 'Disks',
                click: () => {
                    let cmd = settings['Disk Utility']
                    exec(cmd, (err) => {
                        console.log(err)
                    });
                }
            },
            { type: 'separator' },
            { role: 'Close' }
        ]
    },
    {
        label: 'Edit',
        submenu: [
            {
                role: 'copy',
                click: () => {
                    win.sender.send('copy')
                }
            }
        ]
    },
    {
        label: 'View',
        submenu: [
            // {
            //     label: 'Disk Usage Summary',
            //     click: () => {
            //         win.send('get_disk_summary_view')
            //         // get_diskspace_summary();
            //     }
            // },
            // {type: 'separator'},
            {
                label: 'Sort',
                submenu: [
                    {
                        label: 'Date',
                        // accelerator: process.platform === 'darwin' ? 'CTRL+SHIFT+D' : 'CTRL+SHIFT+D',
                        click: () => { win.send('sort', 'date') }
                    },
                    {
                        label: 'Name',
                        click: () => {
                            win.send('sort', 'size')
                        }
                    },
                    {
                        label: 'Size',
                        click: () => { win.send('sort', 'name') }
                    },
                    {
                        label: 'Type',
                        click: () => { win.send('sort', 'type') }
                    },
                ]
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Grid',
                        click: () => {
                            win.send('view', 'grid');
                        }
                    },
                    {
                        label: "List",
                        click: () => {
                            win.send('view', 'list');
                        }
                    }
                ]
            },
            {
                label: 'Show Hidden Files',
                click: () => {
                    // win.send('show_hidden');
                    win.send('msg', 'Error: Not yet implemented');
                }
            },
            { type: 'separator' },
            {
                label: 'Show Sidebar',
                accelerator: process.platform === 'darwin' ? settings.keyboard_shortcuts.ShowSidebar : settings.keyboard_shortcuts.ShowSidebar,
                click: () => {
                    let win = window.getFocusedWindow();
                    win.webContents.send('sidebar');
                }
            },
            {
                type: 'separator'
            },
            {
                label: 'Toggle theme',
                click: () => {
                    if (nativeTheme.shouldUseDarkColors) {
                        nativeTheme.themeSource = 'light'
                    } else {
                        nativeTheme.themeSource = 'dark'
                    }
                }
            },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { type: 'separator' },
            {
                label: 'Appearance',
                role: 'viewMenu'
            },
            { type: 'separator' },
            { role: 'reload' },

        ]
    },
    {
        label: 'Help',
        submenu: [
            {
                label: 'About',
                click: () => {
                    aboutDialog();
                }
            }
        ]
    }

]

const header_menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(header_menu);


