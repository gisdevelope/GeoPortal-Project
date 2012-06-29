/**
 * This javascript file handles page rendering and events.
 *
 * @author      Tobin license
 * @Bradley     MIT
 */

var config;                 // Container for config.json
var map = null;             // map
var selectedAddress = {};   // JSON selected record object
var markers = [];           // Array of markers
var layersControl;          // Leaflet layer control


/*  Document Ready  */
$(document).ready(function() {

    // Load configuration data sychronously
    $.ajax({
        url: "js/config.json",
        dataType: "json",
        async: false,
        success: function(data){
            config = data;
        }
    });

    // jQuery UI Accordion
    $('#accordion-data').accordion({header: "h3", collapsible: true, autoHeight: false, create: function(event, ui) {  $(this).fadeIn("slow");  }}).bind("accordionchange", function(event, ui) {
        if (ui.newHeader[0]) $.publish("/change/accordion", [ ui.newHeader[0].id ]);
    });

    // jQuery UI Dialogs
    $("#search-dialog").dialog({ width: $("#searchdiv").width(), autoOpen: false, show: 'fade', hide: 'fade' });

    // Click events
    $(".searchoptions").click(function(){ $('#search-dialog').dialog('open'); });
    $("#searchinput").click(function() { $(this).select(); });
    $(".selectedLocation").on("click", "a", function() {
        args = $(this).data("panzoom").split(',');
        $.publish("/map/panzoom", [ args[0], args[1], args[2] ]);
    });
    $(".datatable").on("click", "a.locate", function() {
        coords = $(this).data("coords").split(",");
        $.publish("/layers/addmarker", [ coords[0], coords[1], 1, $(this).data("label") ]);
    });

    //  Map toolbar
    $("#mapcontrols").buttonset();
    $("#mapcontrols input:radio").click( function() { toolbar($(this)); });
    $("#toolbar").fadeIn("slow");

    // URL Hash Change Handler
    $(window).hashchange( function(){
        // read the hash
        theHash = window.location.hash.split("/");

        // Process active record change
        if (theHash[1] && theHash[1] != selectedAddress.objectid) {
            locationFinder("Address", 'master_address_table', 'objectid', theHash[1]);
        }

        // Process accordion change
        if (theHash[2] && theHash[2] != $("#accordion-data h3").eq($('#accordion-data').accordion('option', 'active')).attr("id")) {
            $('#accordion-data').accordion('activate', '#' + theHash[2]);
        }
    });

    // Inital PubSub Subscriptions
    $.subscribe("/change/hash", changeHash);  // Hash change control
    $.subscribe("/change/selected", setSelectedAddress);  // Selected record change
    $.subscribe("/change/selected", setLocationText);  // Selected record change
    $.subscribe("/change/selected", accordionDataClearShow);  // Selected record change
    $.subscribe("/change/accordion", processAccordionDataChange);  // Change accordion
    $.subscribe("/layers/addmarker", addMarker);  // Add marker
    $.subscribe("/map/panzoom", zoomToLonLat);  // Zoom to location and zoom


    // jQuery UI Autocomplete
    $("#searchinput").autocomplete({
        minLength: 4,
        delay: 400,
        autoFocus: true,
        source: function(request, response) {

              $.ajax({
                   url: config.web_service_base + "v2/ws_geo_ubersearch.php",
                   dataType: "jsonp",
                   data: {
                        searchtypes: "Address,Library,School,Park,GeoName,Road,CATS,Intersection,PID",
                        query: request.term
                   },
                   success: function(data) {
                        if (data.total_rows > 0) {
                            response($.map(data.rows, function(item) {
                                return {
                                    label: urldecode(item.row.displaytext),
                                    value: item.row.displaytext,
                                    responsetype: item.row.responsetype,
                                    responsetable: item.row.responsetable,
                                    getfield: item.row.getfield,
                                    getid: item.row.getid
                                };
                            }));
                        }
                        else if (data.total_rows == 0) {
                             response($.map([{}], function(item) {
                                  return {
                                        // No records found message
                                       label: "No records found.",
                                       responsetype: "I've got nothing"
                                  };
                             }));
                        }
                        else if  (data.total_rows == -1) {
                             response($.map([{}], function(item) {
                                  return {
                                       // Message indicating no search performed
                                       label: "More information needed for search.",
                                       responsetype: "More please"
                                  };
                             }));
                        }

                   }
              });
         },
         select: function(event, ui) {
            $("#searchinput").autocomplete('widget').trigger('mousedown.choose_option');
              // Run function on selected record
              if (ui.item.responsetable) {
                   locationFinder(ui.item.responsetype, ui.item.responsetable, ui.item.getfield, ui.item.getid, ui.item.value);
              }
         },
         open: function(event, ui) {
            // get enter/return for stubborn browsers
            $(this).keypress(function(e){

                if (e.keyCode == 13 || e.keyCode == 39) {
                   $($(this).data('autocomplete').menu.active).find('a').trigger('click');
                }
            });
            // Go if only 1 result
            menuItems = $("ul.ui-autocomplete li.ui-menu-item");
            if (menuItems.length == 1 && menuItems.text() != "More information needed for search." && menuItems.text() != "No records found.") {
                $($(this).data('autocomplete').menu.active).find('a').trigger('click');
            }
        }
    }).data("autocomplete")._renderMenu = function (ul, items) {
        var self = this, currentCategory = "";
         $.each( items, function( index, item ) {
              if ( item.responsetype != currentCategory && item.responsetype !== undefined) {
                   ul.append( "<li class='ui-autocomplete-category'>" + item.responsetype + "</li>" );
                   currentCategory = item.responsetype;
              }
              self._renderItem( ul, item );
         });
    };

});


/*
    Window Load
    For the stuff that either isn't safe for document ready or for things you don't want to slow page load.
*/
$(window).load(function() {

    // Initialize Map
    initializeMap();

    // Detect HASH arguments
    if (window.location.hash.length > 1) {
       theHash = window.location.hash.split("/");
        // Process the matid
        if (theHash[1] && theHash[1].length > 0 && theHash[1] != selectedAddress.objectid) {
            locationFinder("Address", 'master_address_table', 'objectid', theHash[1]);
        }
        // Process the data tab
        if (theHash[2] && $( "#" + theHash[2] ).length > 0 && $("#accordion-data h3").eq($( "#accordion-data" ).accordion( "option", "active" )).attr("id") != theHash[2]) {
            $('#accordion-data').accordion('activate', '#' + theHash[2]);
        }
    }

});


/*  Hash change handler  */
function changeHash(objectid, tabid) {
    var key = objectid || selectedAddress.objectid || "";
    var tab = tabid || $("#accordion-data h3").eq($( "#accordion-data" ).accordion( "option", "active" )).attr("id");
    window.location.hash = "/" + key + "/" + tab;
}

/*
    Accordion switch handler
    You can toggle a layer when an accordion activates via toggleLayer(layerID)
*/
function processAccordionDataChange(accordionValue) {
    $.publish("/change/hash", [ null, accordionValue ]);
    if (selectedAddress.objectid) { // Make sure an address is selected
        switch (accordionValue) {

            case "SERVICES":
                if ($('#parks table tbody').html().length < 5) { // Make sure information isn't already popupated
                    // Parks
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'parks', 'prkname as name,prkaddr as address,prktype,city, x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat', '', 50000, "", "5", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#parks table tbody").tableGenerator({'fields': ['item.row.name','item.row.address'], 'data': data});
                    });
                    // Get libraries
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'libraries', 'name,address,city, x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat', '', 100000, "", "5", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#libraries table tbody").tableGenerator({'fields': ['item.row.name','item.row.address'], 'data': data});
                    });
                    // Fire Stations
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'fire_stations', 'name,address,station_ty as type,x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat', '', 264000, "", "3", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#fire-stations table tbody").tableGenerator({'fields': ['item.row.name','item.row.type','item.row.address'], 'data': data});
                    });
                }
            break;

            case "TRANSPORTATION":
                if ($('#bus-stops table tbody').html().length == 0) { // Make sure information isn't already popupated
                    // CATS Bus Stops
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'busstops_pt', "stopdesc as name, replace(routes, ',', ', ') as address,x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat", '', 10000, "", "10", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#bus-stops table tbody").tableGenerator({'fields': ['item.row.name','item.row.address'], 'data': data});
                    });
                    // CATS Park and Ride Locations
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'cats_park_and_ride', 'name,routes,address,x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat', '', 100000, "", "3", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#park-and-rides table tbody").tableGenerator({'fields': ['item.row.name','item.row.address','item.row.routes'], 'data': data});
                    });
                    // CATS Light Rail Stops
                    url = pointBuffer(selectedAddress.x_coordinate, selectedAddress.y_coordinate, 2264, 'cats_light_rail_stations', "name,'N/A' as address, x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat", '', 126400, "", "3", 'json', '?');
                    $.getJSON(url, function(data) {
                        $("#light-rail-stops table tbody").tableGenerator({'fields': ['item.row.name'], 'data': data});
                    });
                }
            break;
        }
    }
}



/*  Set selected address  */
function setSelectedAddress(record) {
    selectedAddress = {
        "objectid": record.objectid,
        "x_coordinate": record.x_coordinate,
        "y_coordinate": record.y_coordinate,
        "parcelid": record.parcel_id,
        "address": record.address,
        "postal_city": record.postal_city,
        "lon": record.longitude,
        "lat": record.latitude
    };
}

/*  update selected location text  */
function setLocationText(record) {
    $('.selectedLocation').html('<strong><a href="javascript:void(0)" data-panzoom="' + record.longitude + ', ' + record.latitude + ', 17" > ' + record.address + '</a></strong>');
}

/*  clear data areas and make them visible  */
function accordionDataClearShow() {
    $('.selected-data-clear, .datatable tbody').empty();
    $('.selected-data').show();
}

/*
    Find locations
    @param {string} findType  The type of find to perform
    @param {string} findTable  The table to search on
    @param {string} findField  The field to search in
    @param {string} findID  The value to search for
    @param {string} findValue  The value to search for (street name)
*/
function locationFinder(findType, findTable, findField, findID, findValue) {
    switch (findType) {
        case "Address": case "PID": case "API":
            url = config.web_service_base + 'v1/ws_mat_addressnum.php?format=json&callback=?&jsonp=?&addressnum=' + findID;
            $.getJSON(url, function(data) {
                if (data.total_rows > 0) {
                    $.publish("/change/selected", [ data.rows[0].row ]);
                    $.publish("/change/hash");
                    $.publish("/layers/addmarker", [ data.rows[0].row.longitude, data.rows[0].row.latitude, 0, "<h5>Selected Property</h5>" + data.rows[0].row.address ]);
                    $.publish("/change/accordion", [ $("#accordion-data h3").eq($('#accordion-data').accordion('option', 'active')).attr("id") ]);
                }
            });
            break;
        case "Library": case "Park": case "School": case "GeoName": case "CATS":
            // Set list of fields to retrieve from POI Layers
            poiFields = {
                "libraries" : "x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat, '<h5>' || name || '</h5><p>' || address || '</p>' AS label",
                "schools_1011" : "x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat, '<h5>' || coalesce(schlname,'') || '</h5><p>' || coalesce(type,'') || ' School</p><p>' || coalesce(address,'') || '</p>' AS label",
                "parks" : "x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat, '<h5>' || prkname || '</h5><p>Type: ' || prktype || '</p><p>' || prkaddr || '</p>' AS label",
                "geonames" : "longitude as lon, latitude as lat, '<h5>' || name || '</h5>'  as label",
                "cats_light_rail_stations" : "x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat, '<h5>' || name || '</h5><p></p>' as label",
                "cats_park_and_ride" : "x(transform(the_geom, 4326)) as lon, y(transform(the_geom, 4326)) as lat, '<h5>' || name || '</h5><p>Routes ' || routes || '</p><p>' || address || '</p>' AS label"
            };
            url = config.web_service_base + "v1/ws_geo_attributequery.php?format=json&geotable=" + findTable + "&parameters=" + urlencode(findField + " = " + findID) + "&fields=" + urlencode(poiFields[findTable]) + '&callback=?';
            $.getJSON(url, function(data) {
                $.publish("/layers/addmarker", [ data.rows[0].row.lon, data.rows[0].row.lat, 1, data.rows[0].row.label ]);
            });
            break;
        case "Road":
            url = config.web_service_base + "v1/ws_geo_getcentroid.php?format=json&geotable=" + findTable + "&parameters=streetname='" + findValue + "' order by ll_add limit 1&forceonsurface=true&srid=4326&callback=?";
            $.getJSON(url, function(data) {
                $.publish("/layers/addmarker", [ data.rows[0].row.x, data.rows[0].row.y, 1, "<h5>Road</h5>" + findValue ]);
            });

            break;
        case "Intersection":
            url = config.web_service_base + "v1/ws_geo_centerlineintersection.php?format=json&callback=?";
            streetnameArray = findID.split("&");
            args = "&srid=4326&streetname1=" + urlencode(jQuery.trim(streetnameArray[0])) + "&streetname2=" + urlencode(jQuery.trim(streetnameArray[1]));
            $.getJSON(url + args, function(data) {
                if (data.total_rows > 0 ) {
                    $.publish("/layers/addmarker", [ data.rows[0].row.xcoord, data.rows[0].row.ycoord, 1, "<h5>Intersection</h5>" + findID ]);
                }
            });
            break;
    }
}
