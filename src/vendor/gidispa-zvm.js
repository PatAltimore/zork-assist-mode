/*
 * Minimal GiDispa-compatible shim for ifvms.js's ZVM (Z-machine) engine.
 *
 * glkapi.js's save_allstate()/restore_allstate() (used for autosave) call
 * into a "GiDispa" object for two things: assigning/looking up numeric ids
 * for Glk windows/streams/filerefs, and tracking the array associated with
 * a pending line/char input request so it can be snapshotted and restored.
 *
 * The real GiDispa (erkyrath/quixe, written for Glulx/Quixe) also writes
 * retained arrays back into VM memory by address on completion, via
 * VM.WriteByte/WriteWord -- methods that don't exist on ZVM, and calling
 * it as-is throws on the very first line input request. It also requires
 * a prior make_arg_array() registration from its own dispatch layer, which
 * ZVM never goes through (ZVM calls Glk functions directly). Neither
 * behavior applies here: ZVM shares the actual JS array reference directly
 * with its own input-handling code, so no address-based write-back is
 * needed. This shim provides only the bookkeeping save/restore actually
 * requires, safe for a VM that calls Glk directly rather than through a
 * numeric dispatch layer.
 *
 * This file is original code for this project, not vendored from
 * elsewhere -- see THIRD_PARTY_NOTICES.md.
 */
(function (global) {
    'use strict';

    function GiDispaZVM() {
        var classMaps = {};
        var nextId = {};
        var retained = [];

        this.init = function () {};

        this.class_register = function (clas, obj, usedisprock) {
            classMaps[clas] = classMaps[clas] || {};
            var id;
            if (usedisprock !== undefined && usedisprock !== null) {
                id = usedisprock;
            } else {
                nextId[clas] = nextId[clas] || 1;
                id = nextId[clas]++;
            }
            if (id >= (nextId[clas] || 1)) {
                nextId[clas] = id + 1;
            }
            obj.disprock = id;
            classMaps[clas][id] = obj;
        };

        this.class_unregister = function (clas, obj) {
            if (classMaps[clas]) {
                delete classMaps[clas][obj.disprock];
            }
        };

        this.class_obj_from_id = function (clas, id) {
            if (!id && id !== 0) return null;
            return (classMaps[clas] && classMaps[clas][id]) || null;
        };

        this.retain_array = function (arr, useobj) {
            if (!arr) return;
            var addr = 0, len = arr.length, argInfo = { type: 'char', signed: false };
            if (useobj !== undefined && useobj !== null) {
                addr = useobj.addr;
                len = useobj.len;
                argInfo = useobj.arg || argInfo;
            }
            retained.push({
                arr: arr,
                addr: addr,
                len: len,
                arg: {
                    type: argInfo.type,
                    signed: argInfo.signed,
                    serialize: function () { return { type: this.type, signed: this.signed }; }
                }
            });
        };

        this.get_retained_array = function (arr) {
            for (var i = 0; i < retained.length; i++) {
                if (retained[i] && retained[i].arr === arr) return retained[i];
            }
            return null;
        };

        this.unretain_array = function (arr) {
            // ZVM shares this array reference directly with its own input
            // handling, so there's no VM memory to write back to -- just
            // drop the bookkeeping entry.
            for (var i = 0; i < retained.length; i++) {
                if (retained[i] && retained[i].arr === arr) {
                    retained.splice(i, 1);
                    return;
                }
            }
        };

        this.check_autosave = function () {
            // ZVM only reaches a window update at a clean turn boundary --
            // there's no Glulx-style mid-blocking-call state to worry
            // about -- so it's always a fine time to autosave.
            return 1;
        };

        this.prepare_resume = function () {
            // No-op: ZVM resumes by receiving the event value directly as
            // a normal JS return/callback value, not by GiDispa writing it
            // into VM memory the way Quixe/Glulx requires.
        };
    }

    global.GiDispaZVM = GiDispaZVM;
})(window);
