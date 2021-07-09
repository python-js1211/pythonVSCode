// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable max-classes-per-file */

import { Event, Uri } from 'vscode';
import { IAsyncIterableIterator, iterEmpty } from '../../common/utils/async';
import { PythonEnvInfo, PythonEnvKind } from './info';
import { BasicPythonEnvsChangedEvent, IPythonEnvsWatcher, PythonEnvsChangedEvent, PythonEnvsWatcher } from './watcher';

/**
 * A single update to a previously provided Python env object.
 */
export type PythonEnvUpdatedEvent = {
    /**
     * The iteration index of The env info that was previously provided.
     */
    index: number;
    /**
     * The env info that was previously provided.
     */
    old?: PythonEnvInfo;
    /**
     * The env info that replaces the old info.
     * Update is sent as `undefined` if we find out that the environment is no longer valid.
     */
    update: PythonEnvInfo | undefined;
};

/**
 * A fast async iterator of Python envs, which may have incomplete info.
 *
 * Each object yielded by the iterator represents a unique Python
 * environment.
 *
 * The iterator is not required to have provide all info about
 * an environment.  However, each yielded item will at least
 * include all the `PythonEnvBaseInfo` data.
 *
 * During iteration the information for an already
 * yielded object may be updated.  Rather than updating the yielded
 * object or yielding it again with updated info, the update is
 * emitted by the iterator's `onUpdated` (event) property. Once there are no more updates, the event emits
 * `null`.
 *
 * If the iterator does not have `onUpdated` then it means the
 * provider does not support updates.
 *
 * Callers can usually ignore the update event entirely and rely on
 * the locator to provide sufficiently complete information.
 */
export interface IPythonEnvsIterator extends IAsyncIterableIterator<PythonEnvInfo> {
    /**
     * Provides possible updates for already-iterated envs.
     *
     * Once there are no more updates, `null` is emitted.
     *
     * If this property is not provided then it means the iterator does
     * not support updates.
     */
    onUpdated?: Event<PythonEnvUpdatedEvent | null>;
}

/**
 * An empty Python envs iterator.
 */
export const NOOP_ITERATOR: IPythonEnvsIterator = iterEmpty<PythonEnvInfo>();

/**
 * The most basic info to send to a locator when requesting environments.
 *
 * This is directly correlated with the `BasicPythonEnvsChangedEvent`
 * emitted by watchers.
 */
type BasicPythonLocatorQuery = {
    /**
     * If set as true, ignore the cache and query for fresh environments.
     */
    ignoreCache?: boolean;
    /**
     * If provided, results should be limited to these env
     * kinds; if not provided, the kind of each environment
     * is not considered when filtering
     */
    kinds?: PythonEnvKind[];
};

/**
 * The portion of a query related to env search locations.
 */
type SearchLocations = {
    /**
     * The locations under which to look for environments.
     */
    roots: Uri[];
    /**
     * If true, also look for environments that do not have a search location.
     */
    includeNonRooted?: boolean;
};

/**
 * The full set of possible info to send to a locator when requesting environments.
 *
 * This is directly correlated with the `PythonEnvsChangedEvent`
 * emitted by watchers.
 */
export type PythonLocatorQuery = BasicPythonLocatorQuery & {
    /**
     * If provided, results should be limited to within these locations.
     */
    searchLocations?: SearchLocations;
};

type QueryForEvent<E> = E extends PythonEnvsChangedEvent ? PythonLocatorQuery : BasicPythonLocatorQuery;

/**
 * A single Python environment locator.
 *
 * Each locator object is responsible for identifying the Python
 * environments in a single location, whether a directory, a directory
 * tree, or otherwise.  That location is identified when the locator
 * is instantiated.
 *
 * Based on the narrow focus of each locator, the assumption is that
 * calling iterEnvs() to pick up a changed env is effectively no more
 * expensive than tracking down that env specifically.  Consequently,
 * events emitted via `onChanged` do not need to provide information
 * for the specific environments that changed.
 */
export interface ILocator<E extends BasicPythonEnvsChangedEvent = PythonEnvsChangedEvent>
    extends IPythonEnvsWatcher<E> {
    /**
     * Iterate over the enviroments known tos this locator.
     *
     * Locators are not required to have provide all info about
     * an environment.  However, each yielded item will at least
     * include all the `PythonEnvBaseInfo` data.  To ensure all
     * possible information is filled in, call `ILocator.resolveEnv()`.
     *
     * Updates to yielded objects may be provided via the optional
     * `onUpdated` property of the iterator.  However, callers can
     * usually ignore the update event entirely and rely on the
     * locator to provide sufficiently complete information.
     *
     * @param query - if provided, the locator will limit results to match
     * @returns - the fast async iterator of Python envs, which may have incomplete info
     */
    iterEnvs(query?: QueryForEvent<E>): IPythonEnvsIterator;
}

interface IResolver {
    /**
     * Find as much info about the given Python environment as possible.
     * If executable passed is invalid, then `undefined` is returned.
     *
     * @param env - the Python executable path to resolve more information about
     */
    resolveEnv(env: string): Promise<PythonEnvInfo | undefined>;
}

export interface IResolvingLocator extends IResolver, ILocator {}

interface IEmitter<E extends PythonEnvsChangedEvent> {
    fire(e: E): void;
}

/**
 * The generic base for Python envs locators.
 *
 * By default `resolveEnv()` returns undefined.  Subclasses may override
 * the method to provide an implementation.
 *
 * Subclasses will call `this.emitter.fire()` to emit events.
 *
 * Also, in most cases the default event type (`PythonEnvsChangedEvent`)
 * should be used.  Only in low-level cases should you consider using
 * `BasicPythonEnvsChangedEvent`.
 */
abstract class LocatorBase<E extends BasicPythonEnvsChangedEvent = PythonEnvsChangedEvent> implements ILocator<E> {
    public readonly onChanged: Event<E>;

    protected readonly emitter: IEmitter<E>;

    constructor(watcher: IPythonEnvsWatcher<E> & IEmitter<E>) {
        this.emitter = watcher;
        this.onChanged = watcher.onChanged;
    }

    // eslint-disable-next-line class-methods-use-this
    public abstract iterEnvs(query?: QueryForEvent<E>): IPythonEnvsIterator;
}

/**
 * The base for most Python envs locators.
 *
 * By default `resolveEnv()` returns undefined.  Subclasses may override
 * the method to provide an implementation.
 *
 * Subclasses will call `this.emitter.fire()` * to emit events.
 *
 * In most cases this is the class you will want to subclass.
 * Only in low-level cases should you consider subclassing `LocatorBase`
 * using `BasicPythonEnvsChangedEvent.
 */
export abstract class Locator extends LocatorBase {
    constructor() {
        super(new PythonEnvsWatcher());
    }
}
