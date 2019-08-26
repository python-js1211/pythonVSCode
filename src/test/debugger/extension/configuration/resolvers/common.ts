// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import * as TypeMoq from 'typemoq';
import { IPlatformService } from '../../../../../client/common/platform/types';
import { getNamesAndValues } from '../../../../../client/common/utils/enum';
import { getOSType, OSType } from '../../../../../client/common/utils/platform';

const OS_TYPE = getOSType();

interface IPathModule {
    sep: string;
    dirname(path: string): string;
    join(...paths: string[]): string;
}

// The set of information, related to a target OS, that are available
// to tests.  The target OS is not necessarily the native OS.
type OSTestInfo = [
    string,  // os name
    OSType,
    IPathModule
];

// For each supported OS, provide a set of helpers to use in tests.
export function getInfoPerOS(): OSTestInfo[] {
    return getNamesAndValues(OSType)
        .map(os => {
            const osType = os.value as OSType;
            return [
                os.name,
                osType,
                getPathModuleForOS(osType)
            ];
        });
}

// Decide which "path" module to use.
// By default we use the regular module.
function getPathModuleForOS(osType: OSType): IPathModule {
    if (osType === OS_TYPE) {
        return path;
    }

    // We are testing a different OS from the native one.
    // So use a "path" module matching the target OS.
    return osType === OSType.Windows
        ? path.win32
        : path.posix;
}

// Generate the function to use for populating the
// relevant mocks relative to the target OS.
export function setUpOSMocks(
    osType: OSType,
    platformService: TypeMoq.IMock<IPlatformService>
) {
    platformService.setup(p => p.isWindows)
        .returns(() => osType === OSType.Windows);
    platformService.setup(p => p.isMac)
        .returns(() => osType === OSType.OSX);
    platformService.setup(p => p.isLinux)
        .returns(() => osType === OSType.Linux);
}
