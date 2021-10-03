import { useState } from 'react';
import useAnimationFrame from 'use-animation-frame';
import AVLTree from '../bst/AVLTree';
import compareNums from '../util/compareNums';
import type { KVP }  from '../util/KeyValuePair';
import EventBus, { CallbackFromTuple } from '../util/EventBus';
import AVLNode from '../bst/AVLNode';

export interface PlaybackState {
    playing: boolean,
    playDir: 'forward' | 'reverse',
    time: number,
    length: number,
}

export interface TimedMediaEvents<E> extends Record<string, readonly unknown[]> {
    media: [events: E[], time: number],
    togglePlayback: [nowPlaying: boolean, time: number],
    togglePlayDirection: [playDirection: 'forward' | 'reverse'],
    setMaxTime: [maxTime: number],
    seek: [time: number],
    end: [],
}

export interface TimedMediaAPI<E> {
    readonly on: EventBus<TimedMediaEvents<E>>['on'],
    readonly unsubscribe: EventBus<TimedMediaEvents<E>>['unsubscribe'],
    readonly clear: EventBus<TimedMediaEvents<E>>['clear'],

    readonly playing: boolean,
    readonly playDirection: 'forward' | 'reverse',
    readonly time: number,
    readonly length: number,
}

export default function useTimedMedia<E>(config: Partial<PlaybackState> & { seek?: boolean }, items?: Iterable<KVP<number, E[]>> | null | undefined): TimedMediaAPI<E> {
    const [ timeline ] = useState<AVLTree<number, E>>(() => new AVLTree(compareNums, items));

    const [ playbackState, setPlaybackState ] = useState<PlaybackState>({...{
        playing: true,
        playDir: 'forward',
        time: 0,
        length: timeline.max?.key ?? 0,
    }, ...config});

    const { //make state accessible with less text through object desctructuring. still assign to them through setPlayBackState function though.
        playing,
        playDir,
        time,
        length,
    } = playbackState;

    const [ handlers ] = useState<EventBus<TimedMediaEvents<E>>>(new EventBus());

    const [ playHead, setPlayHead ] = useState<AVLNode<number, E> | undefined>(timeline.root?.search(time, playDir === 'forward' ? 'closest-max' : 'closest-min'));

    // --- --- ---[ update state with new props and handle stuff accordingly ]--- --- ---

    addToPlaybackState(config);

    if (config.playing && config.playing !== playing) { 
        resetPlayHead();
        handlers.dispatch('togglePlayback', playing, time);
    }

    if (config.playDir && config.playDir !== playDir) { 
        resetPlayHead(); 
        handlers.dispatch('togglePlayDirection', playDir);
    }

    if ((config.time && config.time !== time) || config.seek) { 
        resetPlayHead();
        handlers.dispatch('seek', time);
    }

    if (config.length && config.length !== length) { 
        if (time > length)  { // if new maxTime is lower than the time the playhead is at
            addToPlaybackState({
                playing: playDir === 'reverse',
                time: length,
            });
        }
        handlers.dispatch('setLength', length); 
    }

    // --- --- ---[ function declarations for handling changing state, and timer function ]--- --- ---

    //update state with new props
    function addToPlaybackState(newState: Partial<PlaybackState>): void { 
        setPlaybackState({...playbackState, ...newState});
    }

    function resetPlayHead(): void {
        setPlayHead(timeline.root?.search(time, playDir === 'forward' ? 'closest-max' : 'closest-min'));
    }

    useAnimationFrame(({ delta }) => {
        if (!playing) { return; }

        //update currentTime, if we've passed an event node than call handlers and update playHead to next.
        const newTime = playDir === 'forward' ? time + (delta * 1000) : time - (delta * 1000);

        addToPlaybackState({ time: newTime });

        const hasNextEvent = playHead !== undefined && (playDir === 'forward' ? length > playHead.key : playHead.key > 0);
        const hasOverflowed = playDir === 'forward' ? length <= time : time <= 0;

        const nextEvent = playHead ?? playDir === 'forward' ? {key: length, value: []} : {key: 0, value: []};
        const timeUntilNext = playDir === 'forward' ? nextEvent.key - time : time - nextEvent.key;

        if (hasNextEvent && timeUntilNext <= 0) {
            setPlayHead(playDir === 'forward' ? playHead.successor : playHead.predecessor);

            // --- --- ---[ Handlers ]--- --- ---
            handlers.dispatch('media', nextEvent.value, nextEvent.key);
        } 
        if (hasOverflowed) {
            addToPlaybackState({
                playing: false,
                time: playDir === 'forward' ? length : 0,
            });

            // --- --- ---[ Handlers ]--- --- ---
            handlers.dispatch('end');
        }
    }, [playing, playDir, handlers]);

    return {
        on: <K extends keyof TimedMediaEvents<E>>(event: K, callback: CallbackFromTuple<TimedMediaEvents<E>[K]>) => handlers.on(event, callback),
        unsubscribe: <K extends keyof TimedMediaEvents<E>>(event: K, target: number) => handlers.unsubscribe(event, target),
        clear: () => handlers.clear(),

        get playing() { return playing; },
        get playDirection() { return playDir; },
        get time() { return time; },
        get length() { return length; },
    };
}