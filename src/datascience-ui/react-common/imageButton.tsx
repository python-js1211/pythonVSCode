// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import * as React from 'react';
import './imageButton.css';

interface IImageButtonProps {
    baseTheme: string;
    tooltip : string;
    disabled?: boolean;
    hidden?: boolean;
    onClick?(event?: React.MouseEvent<HTMLButtonElement>) : void;
}

export class ImageButton extends React.Component<IImageButtonProps> {
    constructor(props: IImageButtonProps) {
        super(props);
    }

    public render() {
        const classNames = `image-button image-button-${this.props.baseTheme} ${this.props.hidden ? 'hide' : ''}`;
        const innerFilter = this.props.disabled ? 'image-button-inner-disabled-filter' : '';

        return (
            <button role='button' aria-pressed='false' disabled={this.props.disabled} title={this.props.tooltip} className={classNames} onClick={this.props.onClick}>
                <div className={innerFilter} >
                    <div className='image-button-child'>
                        {this.props.children}
                    </div>
                </div>
            </button>
        );
    }

}
