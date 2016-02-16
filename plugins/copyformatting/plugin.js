/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or http://ckeditor.com/license
 */

( function() {
	'use strict';

	CKEDITOR.plugins.add( 'copyformatting', {
		requires: 'contextmenu',
		lang: 'en',
		icons: 'copyformatting',
		hidpi: true,
		init: function( editor ) {
			var plugin = CKEDITOR.plugins.copyformatting;

			editor.addCommand( 'copyFormatting', plugin.commands.copyFormatting );
			editor.addCommand( 'applyFormatting', plugin.commands.applyFormatting );

			editor.ui.addButton( 'CopyFormatting', {
				label: editor.lang.copyformatting.label,
				command: 'copyFormatting',
				toolbar: 'cleanup,0'
			} );

			if ( editor.config.copyFormattingContextMenu ) {
				editor.addMenuGroup( 'styles' );

				editor.addMenuItem( 'applyStyle', {
					label: editor.lang.copyformatting.menuLabel,
					command: 'applyFormatting',
					group: 'styles',
					order: 1
				} );

				editor.contextMenu.addListener( function() {
					return editor.getCommand( 'copyFormatting' ).state === CKEDITOR.TRISTATE_ON ? {
						applyStyle: CKEDITOR.TRISTATE_ON
					} : null;
				} );
			}

			editor.on( 'contentDom', function() {
				editor.editable().attachListener( editor.editable(), 'click', function( evt ) {
					var editor = evt.editor || evt.sender.editor;
					editor.execCommand( 'applyFormatting' );
				} );
			} );

			editor.setKeystroke( [
				[ CKEDITOR.CTRL + CKEDITOR.SHIFT + 67, 'copyFormatting' ],
				[ CKEDITOR.CTRL + CKEDITOR.SHIFT + 86, 'applyFormatting' ]
			] );
		}
	} );

	CKEDITOR.plugins.copyformatting = {
		commands: {
			copyFormatting: {
				exec: function( editor, data ) {
					var	cmd = this,
						isFromKeystroke = data ? data.from == 'keystrokeHandler' : false;

					if ( !isFromKeystroke && cmd.state === CKEDITOR.TRISTATE_ON ) {
						cmd.styles = null;
						return cmd.setState( CKEDITOR.TRISTATE_OFF );
					}

					cmd.styles = CKEDITOR.plugins.copyformatting._extractStylesFromElement( editor.elementPath().lastElement );

					if ( !isFromKeystroke ) {
						cmd.setState( CKEDITOR.TRISTATE_ON );
					}
				}
			},

			applyFormatting: {
				exec: function( editor, data ) {
					var cmd = editor.getCommand( 'copyFormatting' ),
						isFromKeystroke = data ? data.from == 'keystrokeHandler' : false;

					if ( !isFromKeystroke && cmd.state !== CKEDITOR.TRISTATE_ON || !cmd.styles ) {
						return;
					}

					CKEDITOR.plugins.copyformatting._applyFormat( cmd.styles, editor );

					if ( !isFromKeystroke ) {
						cmd.styles = null;
						cmd.setState( CKEDITOR.TRISTATE_OFF );
					}
				}
			}
		},

		/**
		 * Creates attributes dictionary for given element.
		 *
		 * @param {CKEDITOR.dom.element} element Element which attributes should be fetched.
		 * @param {Array} exclude Names of attributes to be excluded from dictionary.
		 * @param {Object} Object containing all element's attributes with their values.
		 * @private
		 */
		_getAttributes: function( element, exclude ) {
			var attributes = {},
				attrDefs = element.$.attributes;

			exclude = CKEDITOR.tools.isArray( exclude ) ? exclude : [];

			for ( var i = 0; i < attrDefs.length; i++ ) {
				if ( CKEDITOR.tools.indexOf( exclude, attrDefs[ i ].name ) === -1 ) {
					attributes[ attrDefs[ i ].name ] = attrDefs[ i ].value;
				}
			}

			return attributes;
		},

		/**
		 * Converts given element into `{@link CKEDITOR.style}` instance.
		 *
		 * @param {CKEDITOR.dom.element} element Element to be converted.
		 * @returns {CKEDITOR.style} Style created from the element.
		 * @private
		 */
		_convertElementToStyle: function( element ) {
			var attributes = {},
				styles = CKEDITOR.tools.parseCssText( CKEDITOR.tools.normalizeCssText( element.getAttribute( 'style' ), true ) ),
				// From which elements styles shouldn't be copied.
				elementsToExclude = [ 'p', 'div', 'body', 'html' ];

			if ( CKEDITOR.tools.indexOf( elementsToExclude, element.getName() ) !== -1 ) {
				return;
			}

			attributes = CKEDITOR.plugins.copyformatting._getAttributes( element, [ 'style' ] );

			return new CKEDITOR.style( {
				element: element.getName(),
				type: CKEDITOR.STYLE_INLINE,
				attributes: attributes,
				styles: styles
			} );
		},

		/**
		 * Extract styles from given element and its ancestors.
		 *
		 * @param {CKEDITOR.dom.element} element Element which styles should be extracted.
		 * @returns {CKEDITOR.style[]} The array containing all extracted styles.
		 * @private
		 */
		_extractStylesFromElement: function( element ) {
			var styles = [];

			do {
				var style = CKEDITOR.plugins.copyformatting._convertElementToStyle( element );
				if ( style ) {
					styles.push( style );
				}
			} while ( ( element = element.getParent() ) && element.type === CKEDITOR.NODE_ELEMENT );

			return styles;
		},

		/**
		 * Get offsets and start and end containers for selected word.
		 * It handles also cases like lu<span style="color: #f00;">n</span>ar.
		 *
		 * @param {CKEDITOR.dom.range} range Selected range.
		 * @returns {Object} Object with properties:
		 * @returns {CKEDITOR.dom.element} startNode Node in which the word's beginning is located.
		 * @returns {Number} startOffset Offset inside `startNode` indicating word's beginning.
		 * @returns {CKEDITOR.dom.element} endNode Node in which the word's ending is located.
		 * @returns {Number} endOffset Offset inside `endNode` indicating word's ending
		 * @private
		 */
		_getSelectedWordOffset: function( range ) {
			var regex = /\b\w+\b/ig,
				contents, match,
				node, startNode, endNode,
				startOffset, endOffset;

			node = startNode = endNode = range.startContainer;

			// Get the word beggining/ending from previous/next node with content (skipping empty nodes and bookmarks)
			function getSiblingNodeOffset( isPrev ) {
				var getSibling = isPrev ? 'getPrevious' : 'getNext',
					currentNode = node,
					regex = /\b/g,
					contents, match;

				do {
					currentNode = currentNode[ getSibling ]();

					// If there is no sibling, text is probably inside element, so get it.
					if ( !currentNode ) {
						currentNode = node.getParent();
					}
				} while ( currentNode && currentNode.getStyle &&
					( currentNode.getStyle( 'display' ) == 'none' || !currentNode.getText() ) );

				// If the node is element, get its HTML and strip all tags and then search for
				// word boundaries. In node.getText tags are replaced by spaces, which breaks
				// getting the right offset.
				contents = currentNode.type == CKEDITOR.NODE_ELEMENT ?
							currentNode.getHtml().replace( /<.*>/g, '' ) : currentNode.getText();

				// If we search for next node, skip the first match (boundary at the start of word)
				if ( !isPrev ) {
					regex.lastIndex = 1;
				}
				match = regex.exec( contents );

				return {
					node: currentNode,
					offset: isPrev ? regex.lastIndex : ( match ? match.index : contents.length )
				};
			}

			contents = node.getText();

			while ( ( match = regex.exec( contents ) ) != null ) {
				if ( match.index + match[ 0 ].length >= range.startOffset ) {
					startOffset = match.index;
					endOffset = match.index + match[ 0 ].length;

					// The word probably begins in previous node.
					if ( match.index === 0 ) {
						var startInfo = getSiblingNodeOffset( true );

						startNode = startInfo.node;
						startOffset = startInfo.offset;
					}

					// The word probably ends in next node
					if ( match.index + match[ 0 ].length == range.endOffset ) {
						var endInfo = getSiblingNodeOffset();

						endNode = endInfo.node;
						endOffset = endInfo.offset;
					}

					return {
						startNode: startNode,
						startOffset: startOffset,
						endNode: endNode,
						endOffset: endOffset
					};
				}
			}

			return null;
		},

		/**
		 * Apply given styles to currently selected content in the editor.
		 *
		 * @param {CKEDITOR.styles[]} styles Array of styles to be applied.
		 * @param {CKEDITOR.editor} editor The editor instance.
		 * @private
		 */
		_applyFormat: function( styles, editor ) {
			var range = editor.getSelection().getRanges()[ 0 ],
				bkms = editor.getSelection().createBookmarks();

			if ( !range ) {
				return;
			}

			if ( range.collapsed ) {
				var newRange = editor.createRange(),
					word = CKEDITOR.plugins.copyformatting._getSelectedWordOffset( range );

				if ( !word ) {
					return;
				}

				newRange.setStart( word.startNode, word.startOffset );
				newRange.setEnd( word.endNode, word.endOffset );
				newRange.select();
			}

			for ( var i = 0; i < styles.length; i++ ) {
				styles[ i ].apply( editor );
			}

			editor.getSelection().selectBookmarks( bkms );
		}
	};

	/**
	 * Indicates if context menu item for applying format should be displayed.
	 *
	 * @cfg
	 * @member CKEDITOR.config
	 */
	CKEDITOR.config.copyFormattingContextMenu = true;
} )();
